//! Facade tests: the zero-config package-level `encode`/`decode` functions
//! over the frozen baseh-expandable-v1 profile.

use baseh::{baseh_expandable_v1, Baseh, DecodeOptions, ErrorCode};
use num_bigint::BigUint;

#[test]
fn encode_returns_a_string() {
    let code = baseh::encode(&BigUint::from(42u64)).unwrap();
    assert!(!code.is_empty());
}

#[test]
fn round_trips_a_range_of_ids() {
    for value in [0u64, 1, 7, 42, 999, 1_156, 4_567_891, u64::MAX] {
        let id = BigUint::from(value);
        let code = baseh::encode(&id).unwrap();
        let result = baseh::decode(&code).unwrap();
        assert_eq!(result.id, id, "round trip failed for {value}");
        assert_eq!(result.canonical_code, code);
        assert!(!result.corrected);
    }
}

#[test]
fn round_trips_a_large_id() {
    let id = BigUint::parse_bytes(b"123456789012345678901234567890", 10).unwrap();
    let code = baseh::encode(&id).unwrap();
    assert_eq!(baseh::decode(&code).unwrap().id, id);
}

#[test]
fn agrees_with_a_manually_constructed_default_instance() {
    let instance = Baseh::new(baseh_expandable_v1()).unwrap();
    for value in [0u64, 42, 1_000_000] {
        let id = BigUint::from(value);
        let code = baseh::encode(&id).unwrap();
        assert_eq!(code, instance.encode(&id).unwrap());
        let expected = instance.decode(&code, &DecodeOptions::default()).unwrap();
        assert_eq!(baseh::decode(&code).unwrap(), expected);
    }
}

#[test]
fn decode_errors_surface_like_the_instance_api() {
    let instance = Baseh::new(baseh_expandable_v1()).unwrap();
    let bogus = "!!!!";
    let facade_err = baseh::decode(bogus).unwrap_err();
    let instance_err = instance
        .decode(bogus, &DecodeOptions::default())
        .unwrap_err();
    assert_eq!(facade_err, instance_err);
    assert_eq!(facade_err.code, ErrorCode::InvalidCharacter);

    // Checksum failure: flip a body character of a valid code.
    let mut code = baseh::encode(&BigUint::from(42u64)).unwrap();
    code.replace_range(0..1, "Z");
    let err = baseh::decode(&code).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidChecksum);
}
