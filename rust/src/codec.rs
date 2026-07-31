//! Full encode/decode flow (spec sections 3, 8, 9, 10, 11, 12).

use std::collections::HashSet;

use num_bigint::BigUint;

use crate::basen::{decode_base_n, encode_base_n};
use crate::checksum::calculate_checksum;
use crate::error::{ErrorCode, HrcError};
use crate::feistel::{inverse_permute, permute};
use crate::profile::{prepare_profile, Permutation, PreparedProfile, Profile};

/// Built-in spoken-confusion candidate maps (spec 3.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ConfusionProfile {
    /// No candidates: correction always fails with INVALID_CHECKSUM.
    /// This is the default, matching the reference decoder.
    #[default]
    None,
    /// B/D and P/T.
    Light,
    /// Light plus M/N and V/W.
    Medium,
    /// Medium plus F/S and C/G.
    Heavy,
}

impl ConfusionProfile {
    fn map(self) -> &'static [(char, &'static [char])] {
        match self {
            ConfusionProfile::None => &[],
            ConfusionProfile::Light => &[('B', &['D']), ('D', &['B']), ('P', &['T']), ('T', &['P'])],
            ConfusionProfile::Medium => &[
                ('B', &['D']),
                ('D', &['B']),
                ('P', &['T']),
                ('T', &['P']),
                ('M', &['N']),
                ('N', &['M']),
                ('V', &['W']),
                ('W', &['V']),
            ],
            ConfusionProfile::Heavy => &[
                ('B', &['D']),
                ('D', &['B']),
                ('P', &['T']),
                ('T', &['P']),
                ('M', &['N']),
                ('N', &['M']),
                ('V', &['W']),
                ('W', &['V']),
                ('F', &['S']),
                ('S', &['F']),
                ('C', &['G']),
                ('G', &['C']),
            ],
        }
    }
}

/// Decode options (spec 12.2). Defaults: strict input, no correction.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DecodeOptions {
    /// Remove ASCII spaces during normalization in addition to separators.
    pub accept_spaces: bool,
    /// Attempt single-symbol spoken-confusion correction after a checksum failure.
    pub try_correction: bool,
    pub confusion_profile: ConfusionProfile,
    /// 0 or 1 in version 1. Anything above 1 is treated as 1.
    pub max_corrections: u32,
}

impl DecodeOptions {
    pub fn strict() -> Self {
        DecodeOptions::default()
    }
}

/// Successful decode result (spec 12.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodeResult {
    pub id: BigUint,
    pub canonical_code: String,
    /// True when the normalized input differed from the canonical code.
    pub corrected: bool,
}

/// Non-throwing validation result (spec 12.4). Never carries an internal ID.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidateOutcome {
    pub valid: bool,
    pub canonical_code: Option<String>,
    pub reason: Option<ErrorCode>,
}

const MAX_CANDIDATES: usize = 64;

fn is_ascii_ws(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\x0B' | '\x0C' | '\r' | ' ')
}

/// Spec 3.1 normalization, steps 1-7. Returns the raw unformatted chars.
fn normalize(
    input: &str,
    profile: &PreparedProfile,
    accept_spaces: bool,
) -> Result<Vec<char>, HrcError> {
    let trimmed = input.trim_matches(is_ascii_ws);
    let mut s: String = if profile.profile.separator.is_empty() {
        trimmed.to_string()
    } else {
        trimmed.replace(&profile.profile.separator, "")
    };
    if accept_spaces {
        s = s.replace(' ', "");
    }
    let p = &profile.profile;
    let normalized: Vec<char> = s
        .chars()
        .map(|c| {
            let c = if p.case_sensitive {
                c
            } else {
                c.to_ascii_uppercase()
            };
            *profile.aliases_norm.get(&c).unwrap_or(&c)
        })
        .collect();
    let allowed: HashSet<char> = profile
        .body_alphabet_norm
        .iter()
        .chain(profile.checksum_alphabet_norm.iter())
        .copied()
        .collect();
    for ch in &normalized {
        if !allowed.contains(ch) {
            return Err(HrcError::customer(
                ErrorCode::InvalidCharacter,
                format!("Symbol {ch:?} is not accepted"),
            ));
        }
    }
    let expected = p.body_length + p.checksum_length;
    if normalized.len() != expected {
        return Err(HrcError::customer(
            ErrorCode::InvalidLength,
            format!("Expected {} symbols, got {}", expected, normalized.len()),
        ));
    }
    Ok(normalized)
}

/// Spec 11. Grouping is presentation only.
fn format_raw(raw: &[char], profile: &PreparedProfile) -> String {
    let p = &profile.profile;
    if p.separator.is_empty() {
        return raw.iter().collect();
    }
    let mut parts: Vec<String> = Vec::with_capacity(p.grouping.len());
    let mut offset = 0;
    for size in &p.grouping {
        parts.push(raw[offset..offset + size].iter().collect());
        offset += size;
    }
    parts.join(&p.separator)
}

/// Spec 10. Substitution-only candidate generation, capped and deduplicated.
fn generate_candidates(
    body: &[char],
    confusion: &[(char, &'static [char])],
    max_edits: u32,
) -> Result<Vec<Vec<char>>, HrcError> {
    if max_edits == 0 {
        return Ok(Vec::new());
    }
    let mut results: Vec<Vec<char>> = Vec::new();
    let mut seen: HashSet<Vec<char>> = HashSet::new();
    for pos in 0..body.len() {
        let source = body[pos];
        for (map_source, replacements) in confusion {
            if *map_source != source {
                continue;
            }
            for replacement in replacements.iter() {
                let mut candidate = body.to_vec();
                candidate[pos] = *replacement;
                if seen.insert(candidate.clone()) {
                    results.push(candidate);
                    if results.len() > MAX_CANDIDATES {
                        return Err(HrcError::new(
                            ErrorCode::TooManyCandidates,
                            "Candidate generation exceeded 64 entries",
                            false,
                        ));
                    }
                }
            }
        }
    }
    Ok(results)
}

/// An HRC codec bound to a validated profile. Pure and stateless; safe to
/// share across threads.
pub struct Hrc {
    profile: PreparedProfile,
}

impl Hrc {
    /// Validate the profile per spec 2.2 and bind it. Invalid profiles are
    /// rejected here (at startup), never on the first customer request.
    pub fn new(profile: Profile) -> Result<Hrc, HrcError> {
        Ok(Hrc {
            profile: prepare_profile(profile)?,
        })
    }

    /// Spec 4: `body_alphabet_len ^ body_length`.
    pub fn capacity(&self) -> &BigUint {
        &self.profile.capacity
    }

    /// The validated profile this codec was built from.
    pub fn profile(&self) -> &Profile {
        &self.profile.profile
    }

    /// Spec 8.
    pub fn encode(&self, id: &BigUint) -> Result<String, HrcError> {
        if *id >= self.profile.capacity {
            return Err(HrcError::customer(
                ErrorCode::OutOfRange,
                format!("ID {id} is outside the profile capacity"),
            ));
        }
        let p = &self.profile.profile;
        let mut value = id.clone();
        if let Permutation::FeistelV1 {
            key_bytes, rounds, ..
        } = &p.permutation
        {
            value = permute(
                &value,
                &self.profile.capacity,
                &p.profile_id,
                key_bytes,
                *rounds,
            )?;
        }
        let body = encode_base_n(&value, &self.profile.body_alphabet_norm, p.body_length);
        let body_chars: Vec<char> = body.chars().collect();
        let checksum = calculate_checksum(&self.profile, &body_chars)?;
        let mut raw = body_chars;
        raw.extend(checksum.chars());
        Ok(format_raw(&raw, &self.profile))
    }

    /// Spec 9.
    pub fn decode(&self, input: &str, options: &DecodeOptions) -> Result<DecodeResult, HrcError> {
        let raw = normalize(input, &self.profile, options.accept_spaces)?;
        let p = &self.profile.profile;
        let mut body: Vec<char> = raw[..p.body_length].to_vec();
        let supplied_checksum: Vec<char> = raw[p.body_length..].to_vec();

        // Spec 3.1 step 6 checks the union of both alphabets (in normalize)
        // and spec 9 adds no partition-specific checks. A body position
        // holding a checksum-only symbol fails as INVALID_CHARACTER inside
        // calculate_checksum; a checksum position holding a body-only symbol
        // simply mismatches below and fails as INVALID_CHECKSUM. This
        // ordering is pinned by the frozen error vectors.
        if calculate_checksum(&self.profile, &body)?
            != supplied_checksum.iter().collect::<String>()
        {
            if !options.try_correction || options.max_corrections == 0 {
                return Err(HrcError::customer(
                    ErrorCode::InvalidChecksum,
                    "The reference code did not pass validation",
                ));
            }
            let candidates =
                generate_candidates(&body, options.confusion_profile.map(), options.max_corrections)?;
            let mut valid: HashSet<Vec<char>> = HashSet::new();
            for candidate in candidates {
                let candidate_checksum = calculate_checksum(&self.profile, &candidate)?;
                if candidate_checksum == supplied_checksum.iter().collect::<String>() {
                    valid.insert(candidate);
                }
            }
            if valid.is_empty() {
                return Err(HrcError::customer(
                    ErrorCode::InvalidChecksum,
                    "The reference code did not pass validation",
                ));
            }
            if valid.len() > 1 {
                return Err(HrcError::new(
                    ErrorCode::AmbiguousInput,
                    "The reference code matches more than one record",
                    false,
                ));
            }
            body = valid.into_iter().next().expect("exactly one valid candidate");
        }

        let mut value = decode_base_n(
            &body,
            self.profile.body_alphabet_norm.len(),
            &self.profile.body_index,
        )?;
        if let Permutation::FeistelV1 {
            key_bytes, rounds, ..
        } = &p.permutation
        {
            value = inverse_permute(
                &value,
                &self.profile.capacity,
                &p.profile_id,
                key_bytes,
                *rounds,
            )?;
        }
        let canonical_code = self.encode(&value)?;
        let canonical_raw: Vec<char> = canonical_code
            .chars()
            .filter(|c| !p.separator.contains(*c))
            .collect();
        Ok(DecodeResult {
            id: value,
            canonical_code,
            corrected: raw != canonical_raw,
        })
    }

    /// Spec 12.4. Never fails on user input; never exposes an internal ID.
    pub fn validate(&self, input: &str, options: &DecodeOptions) -> ValidateOutcome {
        match self.decode(input, options) {
            Ok(result) => ValidateOutcome {
                valid: true,
                canonical_code: Some(result.canonical_code),
                reason: None,
            },
            Err(err) => ValidateOutcome {
                valid: false,
                canonical_code: None,
                reason: Some(err.code),
            },
        }
    }
}
