//! Frozen profile tiers (spec section 17).
//!
//! Each tier is built from the full alphanumeric set with cumulative visual
//! and spoken strips; the spoken strips interact with the visual ones exactly
//! as the web tools derive them, so the tool capacities match.
//!
//!   Minimum  36 symbols, no checksum           2,176,782,336 ids
//!   Light    31 symbols, 1 checksum              887,503,681 ids
//!   Medium   28 symbols, 1 checksum              481,890,304 ids (default)
//!   Heavy    26 symbols, 1 checksum              308,915,776 ids
//!
//! All four keep the typed O/I/L aliases where possible and run the default
//! profanity blocklist. Minimum also uses a hyphen delimiter; the rest have
//! none. The `_p_` variants are identical but with feistel-v1 permutation and
//! require caller-supplied key material.
//!
//! Every helper returns a freshly-built profile on each call, so callers can
//! load a default and modify it.

use crate::profile::{Permutation, Profanity, ProfanityMode, Profile};

const DEFAULT_KEY_ID: &str = "default";
const DEFAULT_ROUNDS: u32 = 8;

const MINIMUM_BODY: &str = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LIGHT_BODY: &str = "0123456789ABCEFGHJKMNPQRSUVWXYZ";
const MEDIUM_BODY: &str = "0123456789ACDEFGHJKMPQRUVXYZ";
const HEAVY_BODY: &str = "0123456789ABCEFHJKMPQRVXYZ";

const LIGHT_CHECK: &str = "234679ACEFGHJKMNPQRUVWXY";
const MEDIUM_CHECK: &str = "234679ACDEFGHJKMPQRUVXY";
const HEAVY_CHECK: &str = "234679ACEFHJKMPQRUVXY";

struct TierShape {
    profile_id: &'static str,
    body_alphabet: &'static str,
    checksum_alphabet: &'static str,
    checksum_length: usize,
    separator: &'static str,
    grouping: &'static [usize],
    aliases: &'static [(char, char)],
}

const MINIMUM: TierShape = TierShape {
    profile_id: "baseh-minimum",
    body_alphabet: MINIMUM_BODY,
    checksum_alphabet: "",
    checksum_length: 0,
    separator: "-",
    grouping: &[3, 3],
    aliases: &[],
};

const LIGHT: TierShape = TierShape {
    profile_id: "baseh-light",
    body_alphabet: LIGHT_BODY,
    checksum_alphabet: LIGHT_CHECK,
    checksum_length: 1,
    separator: "",
    grouping: &[],
    aliases: &[('O', '0'), ('I', '1'), ('L', '1'), ('D', 'B'), ('T', 'P')],
};

const MEDIUM: TierShape = TierShape {
    profile_id: "baseh-medium",
    body_alphabet: MEDIUM_BODY,
    checksum_alphabet: MEDIUM_CHECK,
    checksum_length: 1,
    separator: "",
    grouping: &[],
    aliases: &[
        // B and S are dropped for looking like 8 and 5; since they can never
        // be issued, a typed B is always an 8 and a typed S always a 5.
        ('O', '0'),
        ('I', '1'),
        ('L', '1'),
        ('B', '8'),
        ('S', '5'),
        ('T', 'P'),
        ('N', 'M'),
        ('W', 'V'),
    ],
};

const HEAVY: TierShape = TierShape {
    profile_id: "baseh-heavy",
    body_alphabet: HEAVY_BODY,
    checksum_alphabet: HEAVY_CHECK,
    checksum_length: 1,
    separator: "",
    grouping: &[],
    aliases: &[
        ('O', '0'),
        ('I', '1'),
        ('L', '1'),
        ('D', 'B'),
        ('T', 'P'),
        ('N', 'M'),
        ('W', 'V'),
        ('S', 'F'),
        ('G', 'C'),
    ],
};

fn tier(shape: &TierShape, permutation: Permutation, p_suffix: bool) -> Profile {
    Profile {
        profile_id: format!(
            "{}{}-v1",
            shape.profile_id,
            if p_suffix { "-p" } else { "" }
        ),
        body_alphabet: shape.body_alphabet.to_string(),
        body_length: 6,
        checksum_alphabet: shape.checksum_alphabet.to_string(),
        checksum_length: shape.checksum_length,
        case_sensitive: false,
        separator: shape.separator.to_string(),
        grouping: shape.grouping.to_vec(),
        aliases: shape.aliases.to_vec(),
        permutation,
        profanity: Some(Profanity {
            mode: ProfanityMode::Blocklist,
            words: None,
            extra_words: Vec::new(),
        }),
    }
}

fn keyed(key_bytes: &[u8], key_id: &str, rounds: u32) -> Permutation {
    Permutation::FeistelV1 {
        key_id: if key_id.is_empty() {
            DEFAULT_KEY_ID.to_string()
        } else {
            key_id.to_string()
        },
        key_bytes: key_bytes.to_vec(),
        rounds: if rounds == 0 { DEFAULT_ROUNDS } else { rounds },
    }
}

/// Tier `baseh-minimum-v1`: alphanumeric, no safety strips, no checksum,
/// hyphen-delimited XXX-XXX.
pub fn baseh_minimum_v1() -> Profile {
    tier(&MINIMUM, Permutation::Disabled, false)
}

/// `baseh-minimum` with feistel-v1 permutation. Key material is required;
/// pass an empty `key_id` or `0` rounds for the defaults ("default", 8).
pub fn baseh_minimum_p_v1(key_bytes: &[u8], key_id: &str, rounds: u32) -> Profile {
    tier(&MINIMUM, keyed(key_bytes, key_id, rounds), true)
}

/// Tier `baseh-light-v1`: visual light plus spoken light, one checksum
/// symbol.
pub fn baseh_light_v1() -> Profile {
    tier(&LIGHT, Permutation::Disabled, false)
}

/// `baseh-light` with feistel-v1 permutation. Key material is required.
pub fn baseh_light_p_v1(key_bytes: &[u8], key_id: &str, rounds: u32) -> Profile {
    tier(&LIGHT, keyed(key_bytes, key_id, rounds), true)
}

/// Tier `baseh-medium-v1`: visual medium plus spoken medium, one checksum
/// symbol. The default.
pub fn baseh_medium_v1() -> Profile {
    tier(&MEDIUM, Permutation::Disabled, false)
}

/// `baseh-medium` with feistel-v1 permutation. Key material is required.
pub fn baseh_medium_p_v1(key_bytes: &[u8], key_id: &str, rounds: u32) -> Profile {
    tier(&MEDIUM, keyed(key_bytes, key_id, rounds), true)
}

/// Tier `baseh-heavy-v1`: conservative alphabet plus spoken heavy, one
/// checksum symbol.
pub fn baseh_heavy_v1() -> Profile {
    tier(&HEAVY, Permutation::Disabled, false)
}

/// `baseh-heavy` with feistel-v1 permutation. Key material is required.
pub fn baseh_heavy_p_v1(key_bytes: &[u8], key_id: &str, rounds: u32) -> Profile {
    tier(&HEAVY, keyed(key_bytes, key_id, rounds), true)
}
