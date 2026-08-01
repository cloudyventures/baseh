//! Fixed-length base-N encoding (spec section 5).

use std::collections::HashMap;

use num_bigint::BigUint;

use crate::error::{BasehError, ErrorCode};

/// Spec 5.1. Fixed-length base-N encode, most significant digit first.
pub(crate) fn encode_base_n(value: &BigUint, alphabet: &[char], length: usize) -> String {
    let base = BigUint::from(alphabet.len() as u64);
    let mut out = vec!['0'; length];
    let mut v = value.clone();
    for pos in (0..length).rev() {
        let digit: u64 = (&v % &base)
            .try_into()
            .expect("a remainder below the alphabet length fits u64");
        out[pos] = alphabet[digit as usize];
        v /= &base;
    }
    out.into_iter().collect()
}

/// Integer power for BigUint exponents too small to be worth float math.
pub(crate) fn pow_biguint(base: BigUint, exp: usize) -> BigUint {
    let mut result = BigUint::from(1u64);
    for _ in 0..exp {
        result *= &base;
    }
    result
}

/// Spec 5.2.
pub(crate) fn decode_base_n(
    text: &[char],
    alphabet_len: usize,
    index: &HashMap<char, u32>,
) -> Result<BigUint, BasehError> {
    let base = BigUint::from(alphabet_len as u64);
    let mut value = BigUint::from(0u64);
    for ch in text {
        let digit = index.get(ch).ok_or_else(|| {
            BasehError::customer(
                ErrorCode::InvalidCharacter,
                format!("Symbol {ch:?} is not in the alphabet"),
            )
        })?;
        value = value * &base + BigUint::from(*digit);
    }
    Ok(value)
}
