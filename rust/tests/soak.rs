//! Round-trip soak suite (spec IMPLEMENTATION_SOAK_TESTS.md).
//!
//! Every shipped tier — the four fixed tiers, their keyed `-p` variants, the
//! expandable tier and `baseh-expandable-p-v1` — is round-tripped in two
//! variants: permutation on (as shipped) and a test-only twin with the
//! permutation disabled (`Permutation::Disabled`, the same twin mechanism the
//! expandable tests use; per-generation keys derive from `key_bytes`, so one
//! flag disables permutation across every generation).
//!
//! Two run levels:
//!
//! - CI subset (default, `soak_ci_subset`): sweep capped at 100,000 per
//!   profile/variant, 10,000 random samples.
//! - Full soak (`soak_full`, `#[ignore]`): the bounds of the spec — sweep to
//!   min(1e9, capacity) per profile and 1,000,000 random samples. Runs with
//!   `cargo test -- --ignored soak_full` and requires `BASEH_SOAK=1`; without
//!   the env var it skips cleanly.
//!
//! Overrides for smoke runs: `BASEH_SOAK_SWEEP` caps the per-profile sweep
//! bound, `BASEH_SOAK_RANDOM` sets the random sample count, and
//! `BASEH_SOAK_PROFILE` runs only profiles whose id contains the substring.

use baseh::{
    baseh_expandable_p_v1, baseh_expandable_v1, baseh_heavy_p_v1, baseh_heavy_v1,
    baseh_light_p_v1, baseh_light_v1, baseh_medium_p_v1, baseh_medium_v1, baseh_minimum_p_v1,
    baseh_minimum_v1, Baseh, DecodeOptions, ErrorCode, Mode, Permutation, Profile,
};
use num_bigint::BigUint;
use std::time::Instant;

/// Fixed soak test key (32 bytes) and its key id. Test-only; never shipped.
const KEY_HEX: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const KEY_ID: &str = "soak-test";

/// Fixed seed for the random phase, printed at start so a failure reproduces.
const SEED: u64 = 42;

/// Random-phase id range: [1e9, 1e11), expandable profiles only.
const RANDOM_LO: u64 = 1_000_000_000;
const RANDOM_HI: u64 = 100_000_000_000;

const SWEEP_ABSOLUTE_CAP: u64 = 1_000_000_000;

fn soak_key() -> Vec<u8> {
    hex_decode(KEY_HEX)
}

fn hex_decode(s: &str) -> Vec<u8> {
    assert_eq!(s.len() % 2, 0);
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

/// The ten shipped profiles under test.
fn shipped_profiles() -> Vec<Profile> {
    let key = soak_key();
    vec![
        baseh_minimum_v1(),
        baseh_minimum_p_v1(&key, KEY_ID, 0),
        baseh_light_v1(),
        baseh_light_p_v1(&key, KEY_ID, 0),
        baseh_medium_v1(),
        baseh_medium_p_v1(&key, KEY_ID, 0),
        baseh_heavy_v1(),
        baseh_heavy_p_v1(&key, KEY_ID, 0),
        baseh_expandable_v1(),
        baseh_expandable_p_v1(&key, KEY_ID, 0),
    ]
}

/// Test-only permutation-off twin: the shipped profile with its permutation
/// field disabled. For expandable profiles this disables permutation across
/// all generations, since per-generation keys are derived internally from
/// `key_bytes` only when the profile carries a `FeistelV1` permutation.
fn permutation_off_twin(profile: &Profile) -> Profile {
    let mut twin = profile.clone();
    assert_ne!(
        twin.permutation,
        Permutation::Disabled,
        "{} ships with permutation enabled",
        twin.profile_id
    );
    twin.permutation = Permutation::Disabled;
    twin.profile_id = format!("{}-noperm", twin.profile_id);
    twin
}

/// SplitMix64: small deterministic PRNG; each language picks its own (spec
/// section 4) since round trips are self-verifying.
struct SplitMix64(u64);

impl SplitMix64 {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform-ish draw from [lo, hi) via multiply-high (no modulo bias).
    fn below(&mut self, lo: u64, hi: u64) -> u64 {
        let span = hi - lo;
        lo + ((self.next_u64() as u128 * span as u128) >> 64) as u64
    }
}

fn env_u64(name: &str) -> Option<u64> {
    std::env::var(name).ok().and_then(|v| v.parse().ok())
}

struct Variant {
    label: &'static str,
    profile: Profile,
}

/// Full soak sweep bound for a profile: min(1e9, capacity) for fixed tiers,
/// 1e9 for the expandable tier (spec section 2).
fn full_sweep_bound(h: &Baseh, profile: &Profile) -> u64 {
    match profile.mode {
        Mode::Fixed => {
            let capacity: u64 = h.capacity().try_into().expect("capacity fits u64");
            capacity.min(SWEEP_ABSOLUTE_CAP)
        }
        Mode::Expandable => SWEEP_ABSOLUTE_CAP,
    }
}

/// Sweep phase: round-trip every id in 0..bound. BLOCKED_CODE from the
/// repetition filter or blocklist is counted, not failed; anything else is a
/// hard failure naming profile, variant, phase, id, code and stage.
fn sweep_phase(h: &Baseh, profile_id: &str, variant: &str, bound: u64) {
    let start = Instant::now();
    let progress_step = (bound / 8).max(1);
    let mut blocked = 0u64;
    eprintln!("[soak] {profile_id} variant={variant} phase=sweep bound={bound}");
    for id in 0..bound {
        let id_big = BigUint::from(id);
        let code = match h.encode(&id_big) {
            Ok(code) => code,
            Err(err) if err.code == ErrorCode::BlockedCode => {
                blocked += 1;
                continue;
            }
            Err(err) => panic!(
                "soak failure: profile={profile_id} variant={variant} phase=sweep id={id} \
                 stage=encode error={err}"
            ),
        };
        let decoded = h
            .decode(&code, &DecodeOptions::default())
            .unwrap_or_else(|err| {
                panic!(
                    "soak failure: profile={profile_id} variant={variant} phase=sweep id={id} \
                     code={code} stage=decode error={err}"
                )
            });
        assert_eq!(
            decoded.id, id_big,
            "soak failure: profile={profile_id} variant={variant} phase=sweep id={id} \
             code={code} stage=mismatch"
        );
        if (id + 1) % progress_step == 0 && (id + 1) < bound {
            let elapsed = start.elapsed().as_secs_f64();
            eprintln!(
                "[soak] {profile_id} variant={variant} phase=sweep progress {}/{} \
                 blocked={blocked} throughput={:.0} ids/s",
                id + 1,
                bound,
                (id + 1) as f64 / elapsed
            );
        }
    }
    let elapsed = start.elapsed().as_secs_f64();
    eprintln!(
        "[soak] {profile_id} variant={variant} phase=sweep checked={} blocked={blocked} \
         elapsed={elapsed:.2}s throughput={:.0} ids/s",
        bound - blocked,
        bound as f64 / elapsed
    );
}

/// Random phase: seeded draws from [1e9, 1e11) against an expandable profile.
fn random_phase(h: &Baseh, profile_id: &str, variant: &str, count: u64) {
    let start = Instant::now();
    let mut rng = SplitMix64(SEED);
    let mut blocked = 0u64;
    let mut checked = 0u64;
    eprintln!("[soak] {profile_id} variant={variant} phase=random count={count} seed={SEED}");
    for _ in 0..count {
        let id = rng.below(RANDOM_LO, RANDOM_HI);
        let id_big = BigUint::from(id);
        let code = match h.encode(&id_big) {
            Ok(code) => code,
            Err(err) if err.code == ErrorCode::BlockedCode => {
                blocked += 1;
                continue;
            }
            Err(err) => panic!(
                "soak failure: profile={profile_id} variant={variant} phase=random seed={SEED} \
                 id={id} stage=encode error={err}"
            ),
        };
        let decoded = h
            .decode(&code, &DecodeOptions::default())
            .unwrap_or_else(|err| {
                panic!(
                    "soak failure: profile={profile_id} variant={variant} phase=random \
                     seed={SEED} id={id} code={code} stage=decode error={err}"
                )
            });
        assert_eq!(
            decoded.id, id_big,
            "soak failure: profile={profile_id} variant={variant} phase=random seed={SEED} \
             id={id} code={code} stage=mismatch"
        );
        checked += 1;
    }
    let elapsed = start.elapsed().as_secs_f64();
    eprintln!(
        "[soak] {profile_id} variant={variant} phase=random checked={checked} \
         blocked={blocked} elapsed={elapsed:.2}s throughput={:.0} ids/s",
        count as f64 / elapsed
    );
}

/// Runs both phases over every shipped profile in both permutation variants.
/// `sweep_cap` caps the per-profile sweep bound (None = full soak bounds).
fn run(sweep_cap: Option<u64>, random_count: u64) {
    // Optional profile filter: BASEH_SOAK_PROFILE=expandable runs only the
    // shipped profiles whose id contains the substring.
    let filter = std::env::var("BASEH_SOAK_PROFILE").ok();
    for shipped in shipped_profiles() {
        if let Some(f) = &filter {
            if !shipped.profile_id.contains(f.as_str()) {
                continue;
            }
        }
        let variants = [
            Variant {
                label: "permutation-on",
                profile: shipped.clone(),
            },
            Variant {
                label: "permutation-off",
                profile: permutation_off_twin(&shipped),
            },
        ];
        for variant in variants {
            let profile_id = variant.profile.profile_id.clone();
            let h = Baseh::new(variant.profile.clone())
                .unwrap_or_else(|err| panic!("{profile_id}: {err}"));
            let mut bound = full_sweep_bound(&h, &variant.profile);
            if let Some(cap) = sweep_cap {
                bound = bound.min(cap);
            }
            sweep_phase(&h, &profile_id, variant.label, bound);
            if variant.profile.mode == Mode::Expandable {
                random_phase(&h, &profile_id, variant.label, random_count);
            }
        }
    }
}

/// CI subset (spec section 5): sweep capped at 100,000 per profile/variant,
/// 10,000 random samples. Part of the default `cargo test` run.
#[test]
fn soak_ci_subset() {
    let sweep = env_u64("BASEH_SOAK_SWEEP").unwrap_or(100_000);
    let random = env_u64("BASEH_SOAK_RANDOM").unwrap_or(10_000);
    run(Some(sweep), random);
}

/// Full soak (spec sections 3–4). Opt-in: `BASEH_SOAK=1 cargo test --release
/// -- --ignored soak_full --nocapture`. Without `BASEH_SOAK=1` it skips
/// cleanly even when `--ignored` selects it.
#[test]
#[ignore]
fn soak_full() {
    if std::env::var("BASEH_SOAK").as_deref() != Ok("1") {
        eprintln!("[soak] BASEH_SOAK=1 not set; skipping full soak");
        return;
    }
    let sweep = env_u64("BASEH_SOAK_SWEEP");
    let random = env_u64("BASEH_SOAK_RANDOM").unwrap_or(1_000_000);
    run(sweep, random);
}
