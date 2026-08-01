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

/// Codec mode (spec 2.1/19.9). Profiles that predate the mode field are
/// fixed: the shared frozen vectors pin their byte-for-byte behaviour, so a
/// missing mode is prepared as fixed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Mode {
    /// The classic constant-width behaviour.
    #[default]
    Fixed,
    /// Variable-length codes driven by id magnitude (spec 19).
    Expandable,
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

/// Spec 22. The checksum length that applies to a generation of the given
/// total length: `short_checksum_length` at or below `short_checksum_until`,
/// `checksum_length` above it (and always in fixed mode).
pub(crate) fn effective_checksum_length(profile: &PreparedProfile, length: usize) -> usize {
    let p = &profile.profile;
    if p.mode == Mode::Expandable
        && p.short_checksum_length > 0
        && length <= p.short_checksum_until
    {
        return p.short_checksum_length;
    }
    p.checksum_length
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
    /// Fixed keeps the classic constant-width behaviour; expandable gives
    /// variable-length codes driven by id magnitude (spec 19).
    pub mode: Mode,
    pub body_alphabet: String,
    /// Fixed mode only; ignored in expandable mode.
    pub body_length: usize,
    /// Expandable mode only; `0` selects the default of 4. Must exceed
    /// `checksum_length`.
    pub min_length: usize,
    pub checksum_alphabet: String,
    pub checksum_length: usize,
    /// Spec 22. Expandable mode only; `0` (the default) disables the short
    /// checksum. When set, generations at or below `short_checksum_until`
    /// use this many checksum symbols instead of `checksum_length`.
    pub short_checksum_length: usize,
    /// Spec 22. Required when `short_checksum_length` is set: the last
    /// generation (total length) that uses the short checksum.
    pub short_checksum_until: usize,
    pub case_sensitive: bool,
    pub separator: String,
    /// Expandable mode only; `0` (the default) means the separator always
    /// applies. Must be `0` in fixed mode.
    pub separator_min_length: usize,
    pub grouping: Vec<usize>,
    pub aliases: Vec<(char, char)>,
    pub permutation: Permutation,
    pub profanity: Option<Profanity>,
    /// Spec 21. Maximum allowed run of the same symbol in a raw code. `0`
    /// (the default) disables the filter; otherwise it must be at least 3. A
    /// value above the code length is a legal no-op.
    pub max_repetition: usize,
}

/// A profile after validation, with derived values computed once.
pub(crate) struct PreparedProfile {
    pub profile: Profile,
    pub min_length: usize,
    pub separator_min_length: usize,
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
    let mode = profile.mode;

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
    // Spec 19.2: in expandable mode the zero ban strips 0 and O from the body
    // alphabet silently, before any other validation, exactly like the
    // no-vowels strip of section 18.1.
    if mode == Mode::Expandable {
        body_norm.retain(|c| *c != '0' && *c != 'O');
    }
    let body_set: HashSet<char> = body_norm.iter().copied().collect();
    if body_set.len() != body_norm.len() {
        return Err(fail(
            "body alphabet symbols must be unique after case normalization",
        ));
    }

    if mode == Mode::Fixed && (profile.body_length == 0 || profile.body_length > 32) {
        return Err(fail("bodyLength must be an integer from 1 through 32"));
    }
    let min_length = if profile.min_length == 0 {
        4
    } else {
        profile.min_length
    };
    let separator_min_length = profile.separator_min_length;
    if mode == Mode::Fixed && separator_min_length != 0 {
        return Err(fail("separatorMinLength must be 0 in fixed mode"));
    }
    if profile.checksum_length > 8 {
        return Err(fail("checksumLength must be an integer from 0 through 8"));
    }
    if mode == Mode::Expandable && min_length <= profile.checksum_length {
        return Err(fail("minLength must be greater than checksumLength"));
    }

    // Spec 22. The short checksum is expandable-only; 0 turns it off.
    let short_checksum_length = profile.short_checksum_length;
    let short_checksum_until = profile.short_checksum_until;
    if mode == Mode::Fixed {
        if short_checksum_length != 0 || short_checksum_until != 0 {
            return Err(fail(
                "shortChecksumLength and shortChecksumUntil are expandable-mode only",
            ));
        }
    } else if short_checksum_length != 0 {
        if profile.checksum_length < 1 || short_checksum_length >= profile.checksum_length {
            return Err(fail("shortChecksumLength must be less than checksumLength"));
        }
        if short_checksum_until < min_length {
            return Err(fail(
                "shortChecksumUntil must be an integer of at least minLength",
            ));
        }
        if min_length <= short_checksum_length {
            return Err(fail("minLength must be greater than shortChecksumLength"));
        }
    } else if short_checksum_until != 0 {
        return Err(fail("shortChecksumUntil requires shortChecksumLength"));
    }

    if mode == Mode::Fixed && profile.checksum_length > 0 {
        if profile.checksum_alphabet.chars().count() < 2 {
            return Err(fail(
                "checksumAlphabet needs at least two symbols when checksumLength is positive",
            ));
        }
        if !profile.checksum_alphabet.chars().all(is_ascii_char) {
            return Err(fail("checksum alphabet symbol is not single ASCII"));
        }
    }
    // Spec 19.3: in expandable mode the checksum alphabet is derived, "0"
    // followed by the body alphabet in order. The configured checksumAlphabet
    // is not consulted.
    let mut checksum_norm: Vec<char> = if mode == Mode::Expandable {
        Vec::new()
    } else {
        profile
            .checksum_alphabet
            .chars()
            .map(|c| norm_char(case_sensitive, c))
            .collect()
    };
    if mode == Mode::Fixed {
        let checksum_set: HashSet<char> = checksum_norm.iter().copied().collect();
        if checksum_set.len() != checksum_norm.len() {
            return Err(fail(
                "checksum alphabet symbols must be unique after case normalization",
            ));
        }
    }

    // Spec 18. no-vowels strips vowels before every downstream rule;
    // blocklist only arms the encode-time scan.
    let profanity_mode = profile
        .profanity
        .as_ref()
        .map(|p| p.mode)
        .unwrap_or(ProfanityMode::None);
    if profanity_mode == ProfanityMode::NoVowels {
        body_norm = strip_vowels(&body_norm);
        checksum_norm = strip_vowels(&checksum_norm);
        if body_norm.len() < 2 {
            return Err(fail(
                "no-vowels mode leaves the body alphabet with fewer than two symbols",
            ));
        }
        if mode == Mode::Fixed && profile.checksum_length > 0 && checksum_norm.len() < 2 {
            return Err(fail(
                "no-vowels mode leaves the checksum alphabet with fewer than two symbols",
            ));
        }
    }
    if mode == Mode::Expandable {
        // Derived after every body strip (zero ban, no-vowels) so all
        // downstream rules — modulus, separator collision, alias targets —
        // see the final alphabets.
        checksum_norm = std::iter::once('0').chain(body_norm.iter().copied()).collect();
    }
    if body_norm.len() < 2 {
        return Err(fail(
            "body alphabet needs at least two symbols after preparation",
        ));
    }
    let blocklist = match &profile.profanity {
        Some(p) if p.mode == ProfanityMode::Blocklist => effective_blocklist(p)?,
        _ => Vec::new(),
    };

    // Spec 21: 0 disables the filter; an active filter needs a floor of 3 —
    // banning pairs (2) would destroy roughly 9% of every generation.
    if profile.max_repetition == 1 || profile.max_repetition == 2 {
        return Err(fail("maxRepetition must be 0 (off) or an integer of at least 3"));
    }

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
        // Spec 3.2: an alias must never map two distinct canonical symbols
        // into one value. Fixed mode rejects a canonical alias source
        // outright. In expandable mode the frozen tier (spec 17.1) carries
        // aliases whose sources are canonical body symbols (T, N, W stay in
        // the body alphabet); the canonical symbol wins at normalization,
        // making those entries inert instead of destructive.
        if mode == Mode::Fixed && canonical_set.contains(&s_norm) {
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
    } else if mode == Mode::Expandable {
        // Spec 19.5: the balanced grouping rule is a pure function of the
        // total length, so a configurable grouping is meaningless in
        // expandable mode.
        if !profile.grouping.is_empty() {
            return Err(fail("grouping must be empty in expandable mode"));
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
        // Fixed-mode capacity A^bodyLength. Meaningless in expandable mode.
        capacity: pow_biguint(BigUint::from(body_norm.len() as u64), profile.body_length),
        min_length,
        separator_min_length,
        blocklist,
        body_alphabet_norm: body_norm,
        checksum_alphabet_norm: checksum_norm,
        aliases_norm,
        body_index,
        profile,
    })
}
