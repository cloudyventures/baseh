//! Frozen profiles (spec section 17).

use crate::profile::{Permutation, Profile};

const BODY_ALPHABET: &str = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CHECKSUM_ALPHABET: &str = "234679ACDEFGHJKMNPQRTUVWXY";
const DEFAULT_ROUNDS: u32 = 8;

const ALIASES: &[(char, char)] = &[('O', '0'), ('I', '1'), ('L', '1')];

fn frozen(profile_id: &str, checksum_length: usize, permutation: Permutation) -> Profile {
    Profile {
        profile_id: profile_id.to_string(),
        body_alphabet: BODY_ALPHABET.to_string(),
        body_length: 6,
        checksum_alphabet: CHECKSUM_ALPHABET.to_string(),
        checksum_length,
        case_sensitive: false,
        separator: String::new(),
        grouping: Vec::new(),
        aliases: ALIASES.to_vec(),
        permutation,
        profanity: None,
    }
}

/// Frozen profile `baseh32-v1`: 6 body + 1 checksum, permutation disabled.
/// Assisted-support use; structured single-substitution miss rate about 1.2
/// percent per position (spec 6.3).
pub fn baseh32_v1() -> Profile {
    frozen("baseh32-v1", 1, Permutation::Disabled)
}

/// Frozen profile `baseh32-v1` with the feistel-v1 permutation enabled
/// (8 rounds). Permutation is opt-in: applications assign their own `key_id`
/// and key material and both must be immutable for the life of the profile.
pub fn baseh32_v1_with_key(key_bytes: &[u8], key_id: &str) -> Profile {
    frozen(
        "baseh32-v1",
        1,
        Permutation::FeistelV1 {
            key_id: key_id.to_string(),
            key_bytes: key_bytes.to_vec(),
            rounds: DEFAULT_ROUNDS,
        },
    )
}

/// Frozen profile `baseh32s-v1`: 6 body + 2 checksum, permutation disabled.
/// Self-service use; provably detects all single-symbol substitutions and
/// all adjacent transpositions (spec 6.3).
pub fn baseh32s_v1() -> Profile {
    frozen("baseh32s-v1", 2, Permutation::Disabled)
}

/// Frozen profile `baseh32s-v1` with the feistel-v1 permutation enabled
/// (8 rounds). Permutation is opt-in: applications assign their own `key_id`
/// and key material and both must be immutable for the life of the profile.
pub fn baseh32s_v1_with_key(key_bytes: &[u8], key_id: &str) -> Profile {
    frozen(
        "baseh32s-v1",
        2,
        Permutation::FeistelV1 {
            key_id: key_id.to_string(),
            key_bytes: key_bytes.to_vec(),
            rounds: DEFAULT_ROUNDS,
        },
    )
}
