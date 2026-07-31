//! Fixed-length base-N encoding (spec section 5).

use std::collections::HashMap;

use num_bigint::BigUint;

use crate::error::{ErrorCode, HrcError};

/// Spec 5.1. Fixed-length base-N encode, most significant digit first.
pub(crate) fn encode_base_n(value: &BigUint, alphabet: &[char], length: usize) -> String {
    let base = BigUint::from(alphabet.len() as u64);
    let mut out = vec!['0'; length];
    let mut v = value.clone();
    for pos in (0..length).rev() {
        let digit = (&v % &base)
            .try_into()
            .map(|d: u64| d as usize)
            .unwrap_or(0);
        out[pos] = alphabet[digit];
        v /= &base;
    }
    out.into_iter().collect()
}

/// Spec 5.2.
pub(crate) fn decode_base_n(
    text: &[char],
    alphabet_len: usize,
    index: &HashMap<char, u32>,
) -> Result<BigUint, HrcError> {
    let base = BigUint::from(alphabet_len as u64);
    let mut value = BigUint::from(0u64);
    for ch in text {
        let digit = index.get(ch).ok_or_else(|| {
            HrcError::customer(
                ErrorCode::InvalidCharacter,
                format!("Symbol {ch:?} is not in the alphabet"),
            )
        })?;
        value = value * &base + BigUint::from(*digit);
    }
    Ok(value)
}
