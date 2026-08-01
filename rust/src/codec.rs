//! Full encode/decode flow (spec sections 3, 8, 9, 10, 11, 12 and 18).

use std::collections::HashSet;

use num_bigint::BigUint;

use crate::basen::{decode_base_n, encode_base_n, pow_biguint};
use crate::checksum::calculate_checksum;
use crate::error::{BasehError, ErrorCode};
use crate::feistel::{inverse_permute, permute};
use crate::profile::{
    effective_checksum_length, prepare_profile, Mode, Permutation, PreparedProfile, Profile,
};

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
            ConfusionProfile::Light => {
                &[('B', &['D']), ('D', &['B']), ('P', &['T']), ('T', &['P'])]
            }
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
) -> Result<Vec<char>, BasehError> {
    let trimmed = input.trim_matches(is_ascii_ws);
    let had_separator =
        !profile.profile.separator.is_empty() && trimmed.contains(&profile.profile.separator);
    let mut s: String = if profile.profile.separator.is_empty() {
        trimmed.to_string()
    } else {
        trimmed.replace(&profile.profile.separator, "")
    };
    if accept_spaces {
        s = s.replace(' ', "");
    }
    let p = &profile.profile;
    let allowed: HashSet<char> = profile
        .body_alphabet_norm
        .iter()
        .chain(profile.checksum_alphabet_norm.iter())
        .copied()
        .collect();
    // Spec 3.2: an alias never maps two distinct canonical symbols into one
    // value, so a symbol that is already canonical stays as-is and only
    // non-canonical symbols are aliased. (In fixed tiers alias sources are
    // never canonical, so this changes nothing there.)
    let normalized: Vec<char> = s
        .chars()
        .map(|c| {
            let c = if p.case_sensitive {
                c
            } else {
                c.to_ascii_uppercase()
            };
            if allowed.contains(&c) {
                c
            } else {
                *profile.aliases_norm.get(&c).unwrap_or(&c)
            }
        })
        .collect();
    // Spec 3.1 step 6 runs before spec 3.4 re-padding, so padded zero
    // symbols never raise INVALID_CHARACTER.
    for ch in &normalized {
        if !allowed.contains(ch) {
            return Err(BasehError::customer(
                ErrorCode::InvalidCharacter,
                format!("Symbol {ch:?} is not accepted"),
            ));
        }
    }
    if p.mode == Mode::Expandable {
        // Spec 19.2/19.7: no left-padding and no stripped-zero leniency.
        // Input shorter than minLength or longer than 32 fails
        // INVALID_LENGTH, and a separator below separatorMinLength is
        // rejected (spec 19.5: the decoder expects no separators there).
        if normalized.len() < profile.min_length {
            return Err(BasehError::customer(
                ErrorCode::InvalidLength,
                format!(
                    "Expected at least {} symbols, got {}",
                    profile.min_length,
                    normalized.len()
                ),
            ));
        }
        if normalized.len() > 32 {
            return Err(BasehError::customer(
                ErrorCode::InvalidLength,
                format!("Expected at most 32 symbols, got {}", normalized.len()),
            ));
        }
        if had_separator && normalized.len() < profile.separator_min_length {
            return Err(BasehError::customer(
                ErrorCode::InvalidCharacter,
                format!(
                    "Separators do not appear below {} symbols",
                    profile.separator_min_length
                ),
            ));
        }
        return Ok(normalized);
    }
    let expected = p.body_length + p.checksum_length;
    // Spec 3.4: a code that lost leading zero body symbols is re-padded with
    // the body zero symbol. The checksum symbols always remain, so the split
    // point is unambiguous. A fully stripped no-checksum code would be empty
    // and stays a length error.
    let mut normalized = normalized;
    if normalized.len() < expected && normalized.len() >= p.checksum_length.max(1) {
        let zero = profile.body_alphabet_norm[0];
        let mut padded = vec![zero; expected - normalized.len()];
        padded.extend(normalized);
        normalized = padded;
    }
    if normalized.len() != expected {
        return Err(BasehError::customer(
            ErrorCode::InvalidLength,
            format!("Expected {} symbols, got {}", expected, normalized.len()),
        ));
    }
    Ok(normalized)
}

/// Spec 11/19.5. Grouping is presentation only; skipped when the separator
/// is empty or (expandable) below separatorMinLength.
fn format_raw(raw: &[char], profile: &PreparedProfile) -> String {
    let p = &profile.profile;
    if p.separator.is_empty() {
        return raw.iter().collect();
    }
    if p.mode == Mode::Expandable {
        if raw.len() < profile.separator_min_length {
            return raw.iter().collect();
        }
        return format_with(raw, &expandable_grouping(raw.len()), &p.separator);
    }
    format_with(raw, &p.grouping, &p.separator)
}

fn format_with(raw: &[char], sizes: &[usize], separator: &str) -> String {
    let mut parts: Vec<String> = Vec::with_capacity(sizes.len());
    let mut offset = 0;
    for size in sizes {
        parts.push(raw[offset..offset + size].iter().collect());
        offset += size;
    }
    parts.join(separator)
}

/// Spec 19.5. Group sizes for a total length under the balanced rule:
/// `g = max(2, ceil(L / 5))` groups whose sizes differ by at most one, the
/// larger groups on the left.
pub fn expandable_grouping(length: usize) -> Vec<usize> {
    let g = length.div_ceil(5);
    let g = g.max(2);
    let base = length / g;
    if base < 1 {
        return vec![length];
    }
    let rem = length % g;
    let mut sizes = vec![base + 1; rem];
    sizes.extend(std::iter::repeat_n(base, g - rem));
    sizes
}

/// Spec 19.1/22.3. First id of generation L: the sum of each generation's
/// capacity A^(k - effectiveK(k)) for k from minLength through L-1. The
/// effective checksum length is per-generation (spec 22), so the sum is not
/// a single geometric series when the short checksum is on.
pub(crate) fn generation_base(profile: &PreparedProfile, length: usize) -> BigUint {
    let mut base = BigUint::from(0u64);
    for l in profile.min_length..length {
        base += generation_capacity(profile, l);
    }
    base
}

/// Spec 19.1/22.3. Ids held by generation L: A^(L - effectiveK(L)).
pub(crate) fn generation_capacity(profile: &PreparedProfile, length: usize) -> BigUint {
    pow_biguint(
        BigUint::from(profile.body_alphabet_norm.len() as u64),
        length - effective_checksum_length(profile, length),
    )
}

/// Smallest generation whose range holds id, per spec 19.6. The scan is
/// capped at generation 32 (spec 19.7's maximum code length), so at most
/// `33 - min_length` iterations run; an id beyond that fails OUT_OF_RANGE
/// here instead of looping on ever-larger big integers.
pub(crate) fn generation_for_id(
    profile: &PreparedProfile,
    id: &BigUint,
) -> Result<usize, BasehError> {
    let mut l = profile.min_length;
    let mut base = BigUint::from(0u64);
    let mut cap = generation_capacity(profile, l);
    while *id >= &base + &cap {
        if l >= 32 {
            return Err(BasehError::customer(
                ErrorCode::OutOfRange,
                format!("ID {id} requires a code longer than 32 symbols"),
            ));
        }
        base += &cap;
        l += 1;
        cap = generation_capacity(profile, l);
    }
    Ok(l)
}

/// Spec 10. Substitution-only candidate generation, capped and deduplicated.
fn generate_candidates(
    body: &[char],
    confusion: &[(char, Vec<char>)],
    max_edits: u32,
) -> Result<Vec<Vec<char>>, BasehError> {
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
                        return Err(BasehError::new(
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

/// A baseH codec bound to a validated profile. Pure and stateless; safe to
/// share across threads.
pub struct Baseh {
    profile: PreparedProfile,
}

impl Baseh {
    /// Validate the profile per spec 2.2 and 18 and bind it. Invalid profiles
    /// are rejected here (at startup), never on the first customer request.
    pub fn new(profile: Profile) -> Result<Baseh, BasehError> {
        Ok(Baseh {
            profile: prepare_profile(profile)?,
        })
    }

    /// Spec 4: `body_alphabet_len ^ body_length` (after any vowel stripping).
    ///
    /// Spec 12.3: fixed mode only. Expandable profiles have no single
    /// capacity; use the per-generation formulas of spec 19.1
    /// ([`Baseh::generation_base`], [`Baseh::generation_capacity`]).
    /// Calling this on an expandable profile fails INVALID_PROFILE.
    pub fn capacity(&self) -> Result<&BigUint, BasehError> {
        if self.profile.profile.mode != Mode::Fixed {
            return Err(BasehError::new(
                ErrorCode::InvalidProfile,
                "capacity() is only defined for fixed-mode profiles",
                false,
            ));
        }
        Ok(&self.profile.capacity)
    }

    /// Spec 19.1. First id held by generation `length` (expandable mode).
    pub fn generation_base(&self, length: usize) -> BigUint {
        generation_base(&self.profile, length)
    }

    /// Spec 19.1. Ids held by generation `length` (expandable mode).
    pub fn generation_capacity(&self, length: usize) -> BigUint {
        generation_capacity(&self.profile, length)
    }

    /// Smallest generation whose range holds `id`, per spec 19.6. Fails
    /// OUT_OF_RANGE when `id` needs a code longer than 32 symbols.
    pub fn generation_for_id(&self, id: &BigUint) -> Result<usize, BasehError> {
        generation_for_id(&self.profile, id)
    }

    /// Spec 22. The checksum length that applies to a generation of the
    /// given total length.
    pub fn effective_checksum_length(&self, length: usize) -> usize {
        effective_checksum_length(&self.profile, length)
    }

    /// The validated profile this codec was built from.
    pub fn profile(&self) -> &Profile {
        &self.profile.profile
    }

    /// Spec 8 (fixed mode), including the spec 18 blocklist scan.
    fn encode_fixed(&self, id: &BigUint) -> Result<String, BasehError> {
        if *id >= self.profile.capacity {
            return Err(BasehError::customer(
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
                None,
            )?;
        }
        let body = encode_base_n(&value, &self.profile.body_alphabet_norm, p.body_length);
        let raw = self.finish_encode(body, p.checksum_length)?;
        Ok(format_raw(&raw, &self.profile))
    }

    /// Spec 19.6.
    fn encode_expandable(&self, id: &BigUint) -> Result<String, BasehError> {
        let l = generation_for_id(&self.profile, id)?;
        let p = &self.profile.profile;
        let mut value = id - generation_base(&self.profile, l);
        let domain = generation_capacity(&self.profile, l);
        if let Permutation::FeistelV1 {
            key_bytes, rounds, ..
        } = &p.permutation
        {
            value = permute(
                &value,
                &domain,
                &p.profile_id,
                key_bytes,
                *rounds,
                Some(l as u32),
            )?;
        }
        let k = effective_checksum_length(&self.profile, l);
        let body = encode_base_n(&value, &self.profile.body_alphabet_norm, l - k);
        let raw = self.finish_encode(body, k)?;
        Ok(format_raw(&raw, &self.profile))
    }

    /// Checksum append plus the spec 18.2 blocklist scan over the raw code.
    fn finish_encode(&self, body: String, checksum_length: usize) -> Result<Vec<char>, BasehError> {
        let body_chars: Vec<char> = body.chars().collect();
        let checksum = calculate_checksum(&self.profile, &body_chars, checksum_length)?;
        let mut raw = body_chars;
        raw.extend(checksum.chars());
        // Spec 18.2: case-insensitive substring scan over the raw code.
        if !self.profile.blocklist.is_empty() {
            let upper: String = raw
                .iter()
                .map(|c| c.to_ascii_uppercase())
                .collect::<String>();
            if self.profile.blocklist.iter().any(|w| upper.contains(w)) {
                return Err(BasehError::new(
                    ErrorCode::BlockedCode,
                    "The generated reference contains a blocked substring",
                    false,
                ));
            }
        }
        // Spec 21.2: a run of the same symbol at or above max_repetition
        // blocks the code. Runs are measured on the raw string, so a
        // separator never breaks a run.
        let max = self.profile.profile.max_repetition;
        if max > 0 {
            let mut run = 1;
            for pair in raw.windows(2) {
                run = if pair[0] == pair[1] { run + 1 } else { 1 };
                if run >= max {
                    return Err(BasehError::new(
                        ErrorCode::BlockedCode,
                        "The generated reference repeats a symbol beyond the profile limit",
                        false,
                    ));
                }
            }
        }
        Ok(raw)
    }

    /// Spec 8/19.6, including the spec 18 blocklist scan.
    pub fn encode(&self, id: &BigUint) -> Result<String, BasehError> {
        match self.profile.profile.mode {
            Mode::Fixed => self.encode_fixed(id),
            Mode::Expandable => self.encode_expandable(id),
        }
    }

    /// Spec 9/19.7.
    pub fn decode(&self, input: &str, options: &DecodeOptions) -> Result<DecodeResult, BasehError> {
        let raw = normalize(input, &self.profile, options.accept_spaces)?;
        let p = &self.profile.profile;
        // Spec 22: the generation is selected by the presented total length,
        // so the effective checksum length is a deterministic function of it.
        let effective_k = match p.mode {
            Mode::Expandable => effective_checksum_length(&self.profile, raw.len()),
            Mode::Fixed => p.checksum_length,
        };
        let body_length = match p.mode {
            Mode::Expandable => raw.len() - effective_k,
            Mode::Fixed => p.body_length,
        };
        let mut body: Vec<char> = raw[..body_length].to_vec();
        let supplied_checksum: Vec<char> = raw[body_length..].to_vec();

        // Spec 3.1 step 6 checks the union of both alphabets (in normalize)
        // and spec 9 adds no partition-specific checks. A body position
        // holding a checksum-only symbol fails as INVALID_CHARACTER inside
        // calculate_checksum; a checksum position holding a body-only symbol
        // simply mismatches below and fails as INVALID_CHECKSUM. This
        // ordering is pinned by the frozen error vectors.
        if calculate_checksum(&self.profile, &body, effective_k)?
            != supplied_checksum.iter().collect::<String>()
        {
            if !options.try_correction || options.max_corrections == 0 {
                return Err(BasehError::customer(
                    ErrorCode::InvalidChecksum,
                    "The reference code did not pass validation",
                ));
            }
            // Spec 10: replacements that are not body alphabet symbols are
            // dropped before candidate generation. A suggested symbol the
            // alphabet cannot contain (say a spoken drop on a stripped-
            // alphabet profile) could never validate; generating it anyway
            // would throw INVALID_CHARACTER from the checksum step instead of
            // reporting an honest INVALID_CHECKSUM.
            let body_set: HashSet<char> = self.profile.body_alphabet_norm.iter().copied().collect();
            let filtered_map: Vec<(char, Vec<char>)> = options
                .confusion_profile
                .map()
                .iter()
                .filter_map(|(source, replacements)| {
                    let kept: Vec<char> = replacements
                        .iter()
                        .copied()
                        .filter(|r| body_set.contains(r))
                        .collect();
                    if kept.is_empty() {
                        None
                    } else {
                        Some((*source, kept))
                    }
                })
                .collect();
            let candidates = generate_candidates(&body, &filtered_map, options.max_corrections)?;
            let mut valid: Option<Vec<char>> = None;
            for candidate in candidates {
                let candidate_checksum =
                    calculate_checksum(&self.profile, &candidate, effective_k)?;
                if candidate_checksum == supplied_checksum.iter().collect::<String>() {
                    if valid.is_some() {
                        return Err(BasehError::new(
                            ErrorCode::AmbiguousInput,
                            "The reference code matches more than one record",
                            false,
                        ));
                    }
                    valid = Some(candidate);
                }
            }
            match valid {
                Some(candidate) => body = candidate,
                None => {
                    return Err(BasehError::customer(
                        ErrorCode::InvalidChecksum,
                        "The reference code did not pass validation",
                    ));
                }
            }
        }

        let mut value = decode_base_n(
            &body,
            self.profile.body_alphabet_norm.len(),
            &self.profile.body_index,
        )?;
        if p.mode == Mode::Expandable {
            // Spec 19.7: the offset is de-permuted within the generation's own
            // domain, then the generation base is added back.
            let l = raw.len();
            if let Permutation::FeistelV1 {
                key_bytes, rounds, ..
            } = &p.permutation
            {
                value = inverse_permute(
                    &value,
                    &generation_capacity(&self.profile, l),
                    &p.profile_id,
                    key_bytes,
                    *rounds,
                    Some(l as u32),
                )?;
            }
            value = generation_base(&self.profile, l) + value;
        } else if let Permutation::FeistelV1 {
            key_bytes, rounds, ..
        } = &p.permutation
        {
            value = inverse_permute(
                &value,
                &self.profile.capacity,
                &p.profile_id,
                key_bytes,
                *rounds,
                None,
            )?;
        }
        // Spec 18.2: the canonical re-encode may raise BLOCKED_CODE here,
        // since a blocked string could never have been issued.
        let canonical_code = self.encode(&value)?;
        // Separator removal is literal-substring based (matches the JS
        // reference: split on the separator string, not per character).
        let canonical_raw: Vec<char> = if p.separator.is_empty() {
            canonical_code.chars().collect()
        } else {
            canonical_code.replace(&p.separator, "").chars().collect()
        };
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
