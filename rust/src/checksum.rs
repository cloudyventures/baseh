//! Version 1 rolling polynomial checksum (spec section 6.2).

use std::collections::HashMap;

use num_bigint::BigUint;

use crate::basen::encode_base_n;
use crate::profile::PreparedProfile;

/// Compute the expected checksum string for a normalized body.
pub(crate) fn calculate_checksum(profile: &PreparedProfile, body: &[char]) -> String {
    let p = &profile.profile;
    if p.checksum_length == 0 {
        return String::new();
    }
    let value = checksum_value(profile, body, &profile.body_index);
    encode_base_n(&value, &profile.checksum_alphabet_norm, p.checksum_length)
}

/// Spec 6.2. Rolling polynomial over symbol values, domain-separated by the
/// ASCII profile ID. Returns a value in `0 .. modulus`.
fn checksum_value(
    profile: &PreparedProfile,
    body: &[char],
    body_index: &HashMap<char, u32>,
) -> BigUint {
    let modulus = &profile.checksum_modulus;
    let thirty_seven = BigUint::from(37u64);
    let mut state = BigUint::from(17u64);
    for byte in profile.profile.profile_id.bytes() {
        state = (state * &thirty_seven + BigUint::from(byte) + 1u64) % modulus;
    }
    state = (state * &thirty_seven) % modulus;
    for (pos, ch) in body.iter().enumerate() {
        let sym_value = BigUint::from(*body_index.get(ch).unwrap_or(&0));
        state = (state * &thirty_seven + sym_value + BigUint::from(pos as u64 + 1)) % modulus;
    }
    state
}
