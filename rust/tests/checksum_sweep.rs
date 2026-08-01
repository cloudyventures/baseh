//! Sampled single-substitution checksum sweep (test-suite spec section 6).
//!
//! For each checksummed frozen tier (Light, Medium, Heavy) every sampled
//! body is mutated at every body position with every other canonical body
//! symbol; the checksum must catch every substitution (zero misses, spec
//! section 6.3).
//!
//! Two run levels, consistent with tests/soak.rs:
//!
//! - CI subset (default, `single_substitution_sweep_ci_subset`): 200 sampled
//!   bodies per tier. Override with `BASEH_SWEEP_BODIES`.
//! - Full sweep (`single_substitution_sweep_full`, `#[ignore]`): the spec's
//!   100,000 sampled bodies per tier. Runs with
//!   `BASEH_SOAK=1 cargo test -- --ignored single_substitution_sweep_full`;
//!   without the env var it skips cleanly.

use baseh::{baseh_heavy_v1, baseh_light_v1, baseh_medium_v1, Baseh, DecodeOptions, ErrorCode};
use num_bigint::BigUint;

/// Fixed seed for reproducible sampling, as in tests/soak.rs.
const SEED: u64 = 42;

/// SplitMix64, the same PRNG the soak suite uses.
struct SplitMix64(u64);

impl SplitMix64 {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform-ish draw from [0, bound) via multiply-high (no modulo bias).
    fn below(&mut self, bound: u64) -> u64 {
        ((self.next_u64() as u128 * bound as u128) >> 64) as u64
    }
}

fn env_u64(name: &str) -> Option<u64> {
    std::env::var(name).ok().and_then(|v| v.parse().ok())
}

/// Count single substitutions that the checksum fails to catch.
fn sweep(h: &Baseh, bodies: u64) -> u64 {
    let capacity: u64 = h
        .capacity()
        .unwrap()
        .try_into()
        .expect("frozen-tier capacity fits u64");
    let alphabet: Vec<char> = h.profile().body_alphabet.chars().collect();
    let checksum_length = h.profile().checksum_length;
    let separator = h.profile().separator.clone();
    let options = DecodeOptions::default();
    let mut rng = SplitMix64(SEED);
    let mut misses = 0u64;
    for _ in 0..bodies {
        let id = rng.below(capacity);
        // The frozen tiers run the default blocklist; an id whose code trips
        // it is never issued, so it is skipped (as in the soak suite).
        let code = match h.encode(&BigUint::from(id)) {
            Ok(code) => code,
            Err(err) if err.code == ErrorCode::BlockedCode => continue,
            Err(err) => panic!("in-range id {id} failed to encode: {err}"),
        };
        let raw: Vec<char> = if separator.is_empty() {
            code.chars().collect()
        } else {
            code.replace(&separator, "").chars().collect()
        };
        let body_len = raw.len() - checksum_length;
        for (pos, original) in raw.iter().enumerate().take(body_len) {
            for &sym in &alphabet {
                if sym == *original {
                    continue;
                }
                let mut mutated = raw.clone();
                mutated[pos] = sym;
                let candidate: String = mutated.into_iter().collect();
                match h.decode(&candidate, &options) {
                    Err(err) if err.code == ErrorCode::InvalidChecksum => {}
                    _ => misses += 1,
                }
            }
        }
    }
    misses
}

fn run(bodies: u64) {
    for tier in [baseh_light_v1(), baseh_medium_v1(), baseh_heavy_v1()] {
        let h = Baseh::new(tier).expect("frozen tier valid");
        let misses = sweep(&h, bodies);
        assert_eq!(
            misses,
            0,
            "{}: {misses} single-substitution misses over {bodies} bodies",
            h.profile().profile_id
        );
        eprintln!(
            "[sweep] {} bodies={bodies} misses=0",
            h.profile().profile_id
        );
    }
}

/// CI subset: 200 sampled bodies per tier (override with
/// `BASEH_SWEEP_BODIES`). Part of the default `cargo test` run.
#[test]
fn single_substitution_sweep_ci_subset() {
    run(env_u64("BASEH_SWEEP_BODIES").unwrap_or(200));
}

/// Full sweep (test-suite spec section 6): 100,000 sampled bodies per tier.
/// Opt-in: `BASEH_SOAK=1 cargo test --release -- --ignored
/// single_substitution_sweep_full --nocapture`.
#[test]
#[ignore]
fn single_substitution_sweep_full() {
    if std::env::var("BASEH_SOAK").as_deref() != Ok("1") {
        eprintln!("[sweep] BASEH_SOAK=1 not set; skipping full sweep");
        return;
    }
    run(env_u64("BASEH_SWEEP_BODIES").unwrap_or(100_000));
}
