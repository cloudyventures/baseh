//! Profile data model and validation (spec sections 2 and 18).

use std::collections::{HashMap, HashSet};

use num_bigint::BigUint;

use crate::error::{BasehError, ErrorCode};

/// Reversible permutation configuration for a profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Permutation {
    Disabled,
    /// The only algorithm in version 1: a balanced Feistel network with
    /// cycle walking over the domain `0 .. capacity - 1`.
    FeistelV1 {
        key_id: String,
        key_bytes: Vec<u8>,
        rounds: u32,
    },
}

/// Profanity handling mode (spec 18.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfanityMode {
    /// No filtering (the default; used by the frozen profiles).
    None,
    /// Vowels are stripped from both alphabets before any other
    /// profile-derived computation.
    NoVowels,
    /// The encoder rejects codes containing a blocked substring.
    Blocklist,
}

/// Optional profanity safety configuration (spec 18). It never changes
/// decode behavior for issued codes and never changes identifier capacity
/// accounting: blocked codes are simply never issued by the encoder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profanity {
    pub mode: ProfanityMode,
    /// Replaces the default list when present (mode Blocklist only).
    pub words: Option<Vec<String>>,
    /// Appended to the effective list in either case.
    pub extra_words: Vec<String>,
}

/// Spec 18.2 default list. Deliberately small; applications extend it.
pub const DEFAULT_BLOCKLIST: [&str; 12] = [
    "CRAP", "TWAT", "SHAG", "DAMN", "FCK", "FUC", "SHT", "CNT", "TWT", "DCK", "AZZ", "BCH",
];

/// A baseH profile. Construct one, pass it to [`crate::Baseh::new`] and keep
/// the resulting codec. Profiles are validated at construction per spec 2.2.
///
/// `aliases` is a list of `(source, target)` pairs rather than a map so that
/// duplicate sources (including duplicates that only collide after case
/// normalization) can be detected during validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    pub profile_id: String,
    pub body_alphabet: String,
    pub body_length: usize,
    pub checksum_alphabet: String,
    pub checksum_length: usize,
    pub case_sensitive: bool,
    pub separator: String,
    pub grouping: Vec<usize>,
    pub aliases: Vec<(char, char)>,
    pub permutation: Permutation,
    pub profanity: Option<Profanity>,
}

/// A profile after validation, with derived values computed once.
pub(crate) struct PreparedProfile {
    pub profile: Profile,
    pub body_alphabet_norm: Vec<char>,
    pub checksum_alphabet_norm: Vec<char>,
    pub aliases_norm: HashMap<char, char>,
    pub checksum_modulus: BigUint,
    pub capacity: BigUint,
    pub body_index: HashMap<char, u32>,
    /// Effective blocklist (spec 18.2). Empty unless the mode is Blocklist.
    pub blocklist: Vec<String>,
}

fn fail(reason: impl Into<String>) -> BasehError {
    BasehError::new(
        ErrorCode::InvalidProfile,
        format!("Invalid baseH profile: {}", reason.into()),
        false,
    )
}

/// Printable ASCII per the reference implementation (\x20 through \x7e).
fn is_ascii_char(c: char) -> bool {
    c.is_ascii() && !c.is_ascii_control()
}

fn norm_char(case_sensitive: bool, c: char) -> char {
    if case_sensitive {
        c
    } else {
        c.to_ascii_uppercase()
    }
}

fn pow_biguint(base: BigUint, exp: usize) -> BigUint {
    let mut result = BigUint::from(1u64);
    for _ in 0..exp {
        result *= &base;
    }
    result
}

/// Spec 18.2: replacement semantics first, then augmentation, uppercased
/// and deduplicated.
fn effective_blocklist(profanity: &Profanity) -> Result<Vec<String>, BasehError> {
    let mut list: Vec<String> = match &profanity.words {
        Some(words) => words.clone(),
        None => DEFAULT_BLOCKLIST.iter().map(|w| (*w).to_string()).collect(),
    };
    list.extend(profanity.extra_words.iter().cloned());
    let mut out: Vec<String> = Vec::new();
    for word in list {
        let len = word.chars().count();
        if !(2..=32).contains(&len) || !word.chars().all(|c| c.is_ascii_alphabetic()) {
            return Err(fail("blocklist entries must be 2 through 32 ASCII letters"));
        }
        let upper = word.to_ascii_uppercase();
        if !out.contains(&upper) {
            out.push(upper);
        }
    }
    Ok(out)
}

/// Spec 18.1: vowels removed for no-vowels mode, applied after case
/// normalization.
fn strip_vowels(alphabet_norm: &[char]) -> Vec<char> {
    alphabet_norm
        .iter()
        .copied()
        .filter(|c| !matches!(c, 'A' | 'E' | 'I' | 'O' | 'U'))
        .collect()
}

/// Validates a profile per spec sections 2.2 and 18 and returns it with
/// derived, pre-computed values.
pub(crate) fn prepare_profile(profile: Profile) -> Result<PreparedProfile, BasehError> {
    if profile.profile_id.is_empty() {
        return Err(fail("profileId must be non-empty"));
    }
    if !profile.profile_id.chars().all(is_ascii_char) {
        return Err(fail("profileId must be ASCII"));
    }

    let case_sensitive = profile.case_sensitive;

    if profile.body_alphabet.chars().count() < 2 {
        return Err(fail("bodyAlphabet needs at least two symbols"));
    }
    if !profile.body_alphabet.chars().all(is_ascii_char) {
        return Err(fail("body alphabet symbol is not single ASCII"));
    }
    let mut body_norm: Vec<char> = profile
        .body_alphabet
        .chars()
        .map(|c| norm_char(case_sensitive, c))
        .collect();
    let body_set: HashSet<char> = body_norm.iter().copied().collect();
    if body_set.len() != body_norm.len() {
        return Err(fail(
            "body alphabet symbols must be unique after case normalization",
        ));
    }

    if profile.body_length == 0 || profile.body_length > 32 {
        return Err(fail("bodyLength must be an integer from 1 through 32"));
    }
    if profile.checksum_length > 8 {
        return Err(fail("checksumLength must be an integer from 0 through 8"));
    }

    if profile.checksum_length > 0 {
        if profile.checksum_alphabet.chars().count() < 2 {
            return Err(fail(
                "checksumAlphabet needs at least two symbols when checksumLength is positive",
            ));
        }
        if !profile.checksum_alphabet.chars().all(is_ascii_char) {
            return Err(fail("checksum alphabet symbol is not single ASCII"));
        }
    }
    let mut checksum_norm: Vec<char> = profile
        .checksum_alphabet
        .chars()
        .map(|c| norm_char(case_sensitive, c))
        .collect();
    let checksum_set: HashSet<char> = checksum_norm.iter().copied().collect();
    if checksum_set.len() != checksum_norm.len() {
        return Err(fail(
            "checksum alphabet symbols must be unique after case normalization",
        ));
    }

    // Spec 18. no-vowels strips vowels before every downstream rule;
    // blocklist only arms the encode-time scan.
    let mode = profile
        .profanity
        .as_ref()
        .map(|p| p.mode)
        .unwrap_or(ProfanityMode::None);
    if mode == ProfanityMode::NoVowels {
        body_norm = strip_vowels(&body_norm);
        checksum_norm = strip_vowels(&checksum_norm);
        if body_norm.len() < 2 {
            return Err(fail(
                "no-vowels mode leaves the body alphabet with fewer than two symbols",
            ));
        }
        if profile.checksum_length > 0 && checksum_norm.len() < 2 {
            return Err(fail(
                "no-vowels mode leaves the checksum alphabet with fewer than two symbols",
            ));
        }
    }
    let blocklist = match &profile.profanity {
        Some(p) if p.mode == ProfanityMode::Blocklist => effective_blocklist(p)?,
        _ => Vec::new(),
    };

    for ch in profile.separator.chars() {
        if body_norm.contains(&ch) || checksum_norm.contains(&ch) {
            return Err(fail("separator must not occur in either alphabet"));
        }
    }

    let mut aliases_norm: HashMap<char, char> = HashMap::new();
    let canonical_set: HashSet<char> = body_norm
        .iter()
        .chain(checksum_norm.iter())
        .copied()
        .collect();
    for (src, tgt) in &profile.aliases {
        if !is_ascii_char(*src) || !is_ascii_char(*tgt) {
            return Err(fail("alias entries must be single ASCII characters"));
        }
        let s_norm = norm_char(case_sensitive, *src);
        let t_norm = norm_char(case_sensitive, *tgt);
        if canonical_set.contains(&s_norm) {
            return Err(fail("alias source is already a canonical symbol"));
        }
        if !canonical_set.contains(&t_norm) {
            return Err(fail("alias target is not a canonical symbol"));
        }
        if aliases_norm.contains_key(&s_norm) {
            return Err(fail("duplicate alias source after case normalization"));
        }
        // Alias chains (and therefore cycles) are forbidden: no target may
        // itself be a source. Checked against the full list, so detection
        // does not depend on iteration order.
        if profile
            .aliases
            .iter()
            .any(|(k, _)| norm_char(case_sensitive, *k) == t_norm)
        {
            return Err(fail("alias chain forbidden: target is also a source"));
        }
        aliases_norm.insert(s_norm, t_norm);
    }

    if profile.separator.is_empty() {
        if !profile.grouping.is_empty() {
            return Err(fail("grouping must be empty when separator is empty"));
        }
    } else {
        let total = profile.grouping.iter().try_fold(0usize, |acc, g| {
            if *g == 0 {
                None
            } else {
                acc.checked_add(*g)
            }
        });
        let Some(total) = total else {
            return Err(fail("group sizes must sum to bodyLength + checksumLength"));
        };
        if total != profile.body_length + profile.checksum_length {
            return Err(fail("group sizes must sum to bodyLength + checksumLength"));
        }
    }

    if let Permutation::FeistelV1 {
        key_id,
        key_bytes,
        rounds,
    } = &profile.permutation
    {
        if key_id.is_empty() {
            return Err(fail("permutation requires a keyId"));
        }
        if key_bytes.is_empty() {
            return Err(fail("permutation requires key material"));
        }
        if !(4..=16).contains(rounds) || rounds % 2 != 0 {
            return Err(fail(
                "Feistel rounds must be an even integer from 4 through 16",
            ));
        }
    }

    let modulus_base = BigUint::from(if checksum_norm.is_empty() {
        1u64
    } else {
        checksum_norm.len() as u64
    });
    let body_index: HashMap<char, u32> = body_norm
        .iter()
        .enumerate()
        .map(|(i, c)| (*c, i as u32))
        .collect();

    Ok(PreparedProfile {
        checksum_modulus: pow_biguint(modulus_base, profile.checksum_length),
        capacity: pow_biguint(BigUint::from(body_norm.len() as u64), profile.body_length),
        blocklist,
        body_alphabet_norm: body_norm,
        checksum_alphabet_norm: checksum_norm,
        aliases_norm,
        body_index,
        profile,
    })
}
