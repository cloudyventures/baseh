//! Frozen profile tiers (spec section 17).
//!
//! Each tier is built from the full alphanumeric set with cumulative visual
//! and spoken strips; the spoken strips interact with the visual ones exactly
//! as the web tools derive them, so the tool capacities match.
//!
//!   Minimum  36 symbols, no checksum, XXX-XXX      2,176,782,336 ids
//!   Light    31 symbols, 2 checksums, XXXX-XXXX      887,503,681 ids
//!   Medium   28 symbols, 2 checksums, XXXX-XXXX      481,890,304 ids (default)
//!   Heavy    26 symbols, 2 checksums, XXXX-XXXX      308,915,776 ids
//!
//! All four keep the typed O/I/L aliases where possible, use a hyphen
//! delimiter at the midpoint and run the default profanity blocklist. Every
//! tier permutes with the frozen published key ([`FROZEN_KEY_BYTES`]): the
//! key is public, so the permutation obscures sequence but is not secrecy.
//! The `_p_` variants are identical but permute with caller-supplied key
//! material instead.
//!
//! Every helper returns a freshly-built profile on each call, so callers can
//! load a default and modify it.

use crate::profile::{Mode, Permutation, Profanity, ProfanityMode, Profile};

const FROZEN_KEY_ID: &str = "frozen";
const DEFAULT_KEY_ID: &str = "default";
const DEFAULT_ROUNDS: u32 = 8;

/// The frozen published permutation key. Public by design: it makes issued
/// codes look non-sequential but offers no secrecy, since anyone can read it
/// here. Never swap it on a live namespace; codes only decode with the key
/// they were issued under. Use the `_p_` variants to supply private key
/// material.
pub const FROZEN_KEY_BYTES: &[u8] = b"baseh-frozen-key-v1";

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
    checksum_length: 2,
    separator: "-",
    grouping: &[4, 4],
    aliases: &[('O', '0'), ('I', '1'), ('L', '1'), ('D', 'B'), ('T', 'P')],
};

const MEDIUM: TierShape = TierShape {
    profile_id: "baseh-medium",
    body_alphabet: MEDIUM_BODY,
    checksum_alphabet: MEDIUM_CHECK,
    checksum_length: 2,
    separator: "-",
    grouping: &[4, 4],
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
    checksum_length: 2,
    separator: "-",
    grouping: &[4, 4],
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
        mode: Mode::Fixed,
        body_alphabet: shape.body_alphabet.to_string(),
        body_length: 6,
        min_length: None,
        checksum_alphabet: shape.checksum_alphabet.to_string(),
        checksum_length: shape.checksum_length,
        short_checksum_length: 0,
        short_checksum_until: 0,
        case_sensitive: false,
        separator: shape.separator.to_string(),
        separator_min_length: 0,
        grouping: shape.grouping.to_vec(),
        aliases: shape.aliases.to_vec(),
        permutation,
        profanity: Some(Profanity {
            mode: ProfanityMode::Blocklist,
            words: None,
            extra_words: Vec::new(),
        }),
        max_repetition: 4,
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

/// Permutation every plain tier applies, built from the frozen published key.
fn frozen() -> Permutation {
    keyed(FROZEN_KEY_BYTES, FROZEN_KEY_ID, DEFAULT_ROUNDS)
}

// Spec 17.1: the medium-safety body (27 symbols) -- the full alphanumeric
// set with the visual and spoken medium drops (B, S, I, L, O, T, N, W) plus
// the 0/O zero ban of section 19.2. The zero ban strips 0 and O silently at
// preparation; neither appears in the literal, so it is a no-op here.
const EXPANDABLE_BODY: &str = "123456789ACDEFGHJKMPQRUVXYZ";

/// Spec 17.1. The frozen expandable tier: four characters while the
/// namespace is small, gaining one symbol automatically as issuance climbs
/// past each generation's capacity. The body alphabet is the medium-safety
/// 27-symbol set (visual + spoken medium drops plus the zero ban, spec 19.2);
/// the checksum alphabet derives as "0" plus the body (28 symbols, modulus
/// 784). The hyphen appears from six characters up, split by the balanced
/// grouping rule (6 -> XXX-XXX, 7 -> XXXX-XXX, and so on per the pinned table
/// of spec 19.5).
fn expandable_tier(permutation: Permutation, p_suffix: bool) -> Profile {
    Profile {
        profile_id: format!("baseh-expandable{}-v1", if p_suffix { "-p" } else { "" }),
        mode: Mode::Expandable,
        body_alphabet: EXPANDABLE_BODY.to_string(),
        body_length: 0,
        min_length: Some(4),
        checksum_alphabet: format!("0{EXPANDABLE_BODY}"),
        checksum_length: 2,
        // Spec 22.5: one checksum symbol through total length 5, two above.
        short_checksum_length: 1,
        short_checksum_until: 5,
        case_sensitive: false,
        separator: "-".to_string(),
        separator_min_length: 6,
        grouping: Vec::new(),
        aliases: vec![
            ('O', '0'),
            ('I', '1'),
            ('L', '1'),
            ('B', '8'),
            ('S', '5'),
            ('T', 'P'),
            ('N', 'M'),
            ('W', 'V'),
        ],
        permutation,
        profanity: Some(Profanity {
            mode: ProfanityMode::Blocklist,
            words: None,
            extra_words: Vec::new(),
        }),
        max_repetition: 4,
    }
}

/// The frozen expandable tier `baseh-expandable-v1`; the recommended
/// starting point for new namespaces.
pub fn baseh_expandable_v1() -> Profile {
    expandable_tier(frozen(), false)
}

/// `baseh-expandable` permuted with caller-supplied key material. Key
/// material is required; pass an empty `key_id` or `0` rounds for the
/// defaults ("default", 8).
pub fn baseh_expandable_p_v1(key_bytes: &[u8], key_id: &str, rounds: u32) -> Profile {
    expandable_tier(keyed(key_bytes, key_id, rounds), true)
}

/// Tier `baseh-minimum-v1`: alphanumeric, no safety strips, no checksum,
/// hyphen-delimited XXX-XXX.
pub fn baseh_minimum_v1() -> Profile {
    tier(&MINIMUM, frozen(), false)
}

/// `baseh-minimum` permuted with caller-supplied key material instead of the
/// frozen key. Key material is required; pass an empty `key_id` or `0` rounds
/// for the defaults ("default", 8).
pub fn baseh_minimum_p_v1(key_bytes: &[u8], key_id: &str, rounds: u32) -> Profile {
    tier(&MINIMUM, keyed(key_bytes, key_id, rounds), true)
}

/// Tier `baseh-light-v1`: visual light plus spoken light, two checksum
/// symbols, hyphen-delimited.
pub fn baseh_light_v1() -> Profile {
    tier(&LIGHT, frozen(), false)
}

/// `baseh-light` permuted with caller-supplied key material. Key material is
/// required.
pub fn baseh_light_p_v1(key_bytes: &[u8], key_id: &str, rounds: u32) -> Profile {
    tier(&LIGHT, keyed(key_bytes, key_id, rounds), true)
}

/// Tier `baseh-medium-v1`: visual medium plus spoken medium, two checksum
/// symbols, hyphen-delimited. The default.
pub fn baseh_medium_v1() -> Profile {
    tier(&MEDIUM, frozen(), false)
}

/// `baseh-medium` permuted with caller-supplied key material. Key material is
/// required.
pub fn baseh_medium_p_v1(key_bytes: &[u8], key_id: &str, rounds: u32) -> Profile {
    tier(&MEDIUM, keyed(key_bytes, key_id, rounds), true)
}

/// Tier `baseh-heavy-v1`: conservative alphabet plus spoken heavy, two
/// checksum symbols, hyphen-delimited.
pub fn baseh_heavy_v1() -> Profile {
    tier(&HEAVY, frozen(), false)
}

/// `baseh-heavy` permuted with caller-supplied key material. Key material is
/// required.
pub fn baseh_heavy_p_v1(key_bytes: &[u8], key_id: &str, rounds: u32) -> Profile {
    tier(&HEAVY, keyed(key_bytes, key_id, rounds), true)
}
