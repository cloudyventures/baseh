//! Property tests (proptest): round-trip invariants over random ids, plus a
//! `#[ignore]`d timing benchmark (the lighter alternative to a criterion
//! harness; run with `cargo test --release -- --ignored bench --nocapture`).

use baseh::{
    baseh_expandable_v1, baseh_heavy_v1, baseh_light_v1, baseh_medium_v1, baseh_minimum_v1, Baseh,
    DecodeOptions, ErrorCode,
};
use num_bigint::BigUint;
use proptest::prelude::*;
use std::time::Instant;

fn fixed_tiers() -> Vec<Baseh> {
    [
        baseh_minimum_v1(),
        baseh_light_v1(),
        baseh_medium_v1(),
        baseh_heavy_v1(),
    ]
    .into_iter()
    .map(|p| Baseh::new(p).expect("frozen tier valid"))
    .collect()
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// Any u64 reduced into a fixed tier's capacity round-trips, and the
    /// canonical code is stable under decode/encode.
    #[test]
    fn fixed_tier_round_trip(id in any::<u64>()) {
        let options = DecodeOptions::default();
        for h in fixed_tiers() {
            let capacity: u64 = h.capacity().unwrap().try_into().unwrap();
            let id = BigUint::from(id % capacity);
            // The frozen tiers run the default blocklist; skip ids whose
            // code is never issued (as in the soak suite).
            let code = match h.encode(&id) {
                Ok(code) => code,
                Err(err) if err.code == ErrorCode::BlockedCode => continue,
                Err(err) => panic!("encode failed: {err}"),
            };
            let decoded = h.decode(&code, &options).unwrap();
            prop_assert_eq!(&decoded.id, &id);
            prop_assert_eq!(&decoded.canonical_code, &code);
            prop_assert!(!decoded.corrected);
            // Canonical stability: re-encoding the decoded id reproduces the
            // reporting code, and validate agrees with decode.
            prop_assert_eq!(h.encode(&decoded.id).unwrap(), code.clone());
            let outcome = h.validate(&code, &options);
            prop_assert!(outcome.valid);
            prop_assert_eq!(outcome.canonical_code, Some(code));
        }
    }

    /// Any u64 round-trips through the expandable tier at its natural
    /// generation length. Ids whose code trips the blocklist are never
    /// issued, so they are skipped (as in the soak suite).
    #[test]
    fn expandable_round_trip(id in any::<u64>()) {
        let h = Baseh::new(baseh_expandable_v1()).unwrap();
        let options = DecodeOptions::default();
        let id = BigUint::from(id);
        let code = match h.encode(&id) {
            Ok(code) => code,
            Err(err) if err.code == ErrorCode::BlockedCode => return Ok(()),
            Err(err) => panic!("encode failed: {err}"),
        };
        let raw_len = code.chars().filter(|c| *c != '-').count();
        prop_assert_eq!(h.generation_for_id(&id).unwrap(), raw_len);
        let decoded = h.decode(&code, &options).unwrap();
        prop_assert_eq!(&decoded.id, &id);
        prop_assert_eq!(&decoded.canonical_code, &code);
        prop_assert!(!decoded.corrected);
    }
}

/// Timing benchmark, opt-in: `cargo test --release -- --ignored
/// bench_encode_decode --nocapture`.
#[test]
#[ignore]
fn bench_encode_decode() {
    let h = Baseh::new(baseh_medium_v1()).unwrap();
    let options = DecodeOptions::default();
    let n = 100_000u64;

    let start = Instant::now();
    let mut codes = Vec::with_capacity(n as usize);
    let mut blocked = 0u64;
    for id in 0..n {
        // The frozen tiers run the default blocklist; skip unissued codes.
        match h.encode(&BigUint::from(id)) {
            Ok(code) => codes.push((id, code)),
            Err(err) if err.code == ErrorCode::BlockedCode => blocked += 1,
            Err(err) => panic!("encode failed: {err}"),
        }
    }
    let encode_elapsed = start.elapsed().as_secs_f64();

    let start = Instant::now();
    for (id, code) in &codes {
        let decoded = h.decode(code, &options).unwrap();
        assert_eq!(decoded.id, BigUint::from(*id));
    }
    let decode_elapsed = start.elapsed().as_secs_f64();

    eprintln!(
        "[bench] medium encode: {:.0}/s ({:.3} us/op), decode: {:.0}/s ({:.3} us/op) over {n} ids \
         (blocked={blocked})",
        n as f64 / encode_elapsed,
        encode_elapsed * 1e6 / n as f64,
        n as f64 / decode_elapsed,
        decode_elapsed * 1e6 / n as f64,
    );
}
