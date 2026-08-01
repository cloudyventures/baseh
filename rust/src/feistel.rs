//! Feistel-v1 reversible permutation (spec section 7.3).
//!
//! Balanced Feistel network with alternating half widths, an HMAC-SHA-256
//! round function truncated to the low N bits and cycle walking to keep
//! outputs inside `0 .. capacity - 1`.

use hmac::{Hmac, Mac};
use num_bigint::BigUint;
use sha2::Sha256;

use crate::error::{BasehError, ErrorCode};

const TAG: &[u8] = b"BASEH-FEISTEL-V1";
const MAX_WALKS: u32 = 1000;

type HmacSha256 = Hmac<Sha256>;

/// Number of bits needed to represent `capacity - 1` (`ceil(log2(capacity))`
/// for capacity >= 2).
fn bit_length(capacity: &BigUint) -> usize {
    let one = BigUint::from(1u64);
    (capacity - one).bits() as usize
}

/// Low n bits of the digest: first ceil(n / 8) bytes read big-endian,
/// masked with `2^n - 1`.
fn low_bits(digest: &[u8], n: usize) -> BigUint {
    let byte_count = n.div_ceil(8);
    let mut v = BigUint::from(0u64);
    for byte in digest.iter().take(byte_count) {
        v = (v << 8usize) | BigUint::from(*byte);
    }
    if n == 0 {
        return BigUint::from(0u64);
    }
    let mask = (BigUint::from(1u64) << n) - 1u64;
    v & mask
}

/// Unsigned big-endian encoding in exactly `byte_count` bytes.
fn to_be(value: &BigUint, byte_count: usize) -> Vec<u8> {
    let raw = value.to_bytes_be();
    if raw.len() >= byte_count {
        raw[raw.len() - byte_count..].to_vec()
    } else {
        let mut out = vec![0u8; byte_count - raw.len()];
        out.extend_from_slice(&raw);
        out
    }
}

fn round_message(profile_id: &str, round: u32, right: &BigUint, wr: usize) -> Vec<u8> {
    let right_bytes = to_be(right, wr.div_ceil(8));
    let mut msg = Vec::with_capacity(TAG.len() + 1 + profile_id.len() + 1 + 1 + right_bytes.len());
    msg.extend_from_slice(TAG);
    msg.push(0);
    msg.extend_from_slice(profile_id.as_bytes());
    msg.push(0);
    msg.push(round as u8);
    msg.extend_from_slice(&right_bytes);
    msg
}

struct Key<'a> {
    profile_id: &'a str,
    key_bytes: &'a [u8],
    rounds: u32,
}

struct Halves {
    left: BigUint,
    right: BigUint,
}

fn round_f(key: &Key<'_>, round: u32, value: &BigUint, wr: usize, wl: usize) -> BigUint {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(key.key_bytes)
        .expect("HMAC accepts keys of any length");
    mac.update(&round_message(key.profile_id, round, value, wr));
    let digest = mac.finalize().into_bytes();
    low_bits(&digest, wl)
}

fn widths(i: u32, w0: usize, w1: usize) -> (usize, usize) {
    if i.is_multiple_of(2) {
        (w1, w0)
    } else {
        (w0, w1)
    }
}

fn run_rounds(h: Halves, key: &Key<'_>, w0: usize, w1: usize) -> Halves {
    let Halves {
        mut left,
        mut right,
    } = h;
    for i in 0..key.rounds {
        let (wr, wl) = widths(i, w0, w1);
        let f = round_f(key, i, &right, wr, wl);
        let new_left = right;
        let new_right = left ^ &f;
        left = new_left;
        right = new_right;
    }
    Halves { left, right }
}

fn run_inverse(h: Halves, key: &Key<'_>, w0: usize, w1: usize) -> Halves {
    let Halves {
        mut left,
        mut right,
    } = h;
    for i in (0..key.rounds).rev() {
        let (wr, wl) = widths(i, w0, w1);
        let f = round_f(key, i, &left, wr, wl);
        let prev_right = left;
        let prev_left = right ^ &f;
        left = prev_left;
        right = prev_right;
    }
    Halves { left, right }
}

fn combine(h: &Halves, w1: usize) -> BigUint {
    (&h.left << w1) | &h.right
}

fn split(value: &BigUint, w1: usize) -> Halves {
    let mask = (BigUint::from(1u64) << w1) - 1u64;
    Halves {
        left: value >> w1,
        right: value & &mask,
    }
}

fn walk(
    value: &BigUint,
    capacity: &BigUint,
    key: &Key<'_>,
    forward: bool,
) -> Result<BigUint, BasehError> {
    let bits = bit_length(capacity);
    let w1 = bits / 2;
    let w0 = bits - w1;
    let mut v = value.clone();
    for _ in 0..MAX_WALKS {
        let h = split(&v, w1);
        let out = combine(
            &if forward {
                run_rounds(h, key, w0, w1)
            } else {
                run_inverse(h, key, w0, w1)
            },
            w1,
        );
        if out < *capacity {
            return Ok(out);
        }
        v = out;
    }
    Err(BasehError::new(
        ErrorCode::PermutationFailure,
        "Feistel cycle walking exceeded 1000 iterations",
        false,
    ))
}

/// Spec 7.3 forward permutation with cycle walking.
pub fn permute(
    value: &BigUint,
    capacity: &BigUint,
    profile_id: &str,
    key_bytes: &[u8],
    rounds: u32,
) -> Result<BigUint, BasehError> {
    walk(
        value,
        capacity,
        &Key {
            profile_id,
            key_bytes,
            rounds,
        },
        true,
    )
}

/// Spec 7.3 inverse permutation with cycle walking.
pub fn inverse_permute(
    value: &BigUint,
    capacity: &BigUint,
    profile_id: &str,
    key_bytes: &[u8],
    rounds: u32,
) -> Result<BigUint, BasehError> {
    walk(
        value,
        capacity,
        &Key {
            profile_id,
            key_bytes,
            rounds,
        },
        false,
    )
}
