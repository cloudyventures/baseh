//! Zero-config pair tests, mirroring js/test/zero.test.ts.

use baseh::{baseh_medium_v1, from_code, to_code, Baseh, DecodeOptions, ErrorCode};
use num_bigint::BigUint;

fn medium() -> Baseh {
    Baseh::new(baseh_medium_v1()).unwrap()
}

fn medium_encode(id: u64) -> String {
    medium().encode(&BigUint::from(id)).unwrap()
}

fn expect_code(result: Result<BigUint, baseh::BasehError>, code: ErrorCode) {
    let err = match result {
        Ok(value) => panic!("expected {code}, got id {value}"),
        Err(err) => err,
    };
    assert_eq!(err.code, code);
}

fn expect_to_code_error(result: Result<String, baseh::BasehError>, code: ErrorCode) {
    let err = match result {
        Ok(code_str) => panic!("expected {code}, got code {code_str}"),
        Err(err) => err,
    };
    assert_eq!(err.code, code);
}

#[test]
fn zero_config_matches_the_frozen_medium_profile() {
    assert_eq!(to_code(0u64).unwrap(), medium_encode(0));
    assert_eq!(to_code(123456789u64).unwrap(), medium_encode(123456789));
    assert_eq!(to_code(481890303u64).unwrap(), "ZZZZZZV");
    assert_eq!(to_code(0u64).unwrap(), "000000C");
}

#[test]
fn to_code_accepts_biguint_int_and_decimal_string() {
    assert_eq!(
        to_code(BigUint::from(123456789u64)).unwrap(),
        to_code(123456789u64).unwrap()
    );
    assert_eq!(
        to_code(123456789u64).unwrap(),
        to_code("123456789").unwrap()
    );
    assert_eq!(
        to_code(123456789u64).unwrap(),
        to_code(123456789u128).unwrap()
    );
}

#[test]
#[should_panic(expected = "to_code expects a non-negative integer or a decimal string")]
fn to_code_rejects_non_decimal_string() {
    let _ = to_code("12x3");
}

#[test]
#[should_panic(expected = "to_code expects a non-negative integer or a decimal string")]
fn to_code_rejects_empty_string() {
    let _ = to_code("");
}

#[test]
fn to_code_errors_on_out_of_range_and_blocklisted_ids() {
    // One past the Medium capacity.
    expect_to_code_error(to_code(481890304u64), ErrorCode::OutOfRange);
    // 1131 is reserved by the Medium blocklist.
    expect_to_code_error(to_code(1131u64), ErrorCode::BlockedCode);
}

#[test]
fn from_code_returns_a_biguint_and_round_trips() {
    let id = from_code(&to_code(123456789u64).unwrap()).unwrap();
    assert_eq!(id, BigUint::from(123456789u64));
}

#[test]
fn from_code_accepts_lowercase_aliases_and_any_whitespace() {
    let c = to_code(123456789u64).unwrap();
    assert_eq!(
        from_code(&c.to_lowercase()).unwrap(),
        BigUint::from(123456789u64)
    );
    let messy = format!("  {} {}\t{} ", &c[..3], &c[3..5], &c[5..]);
    assert_eq!(from_code(&messy).unwrap(), BigUint::from(123456789u64));
    // Typed aliases decode to canonical values.
    assert_eq!(from_code("OOOOOOC").unwrap(), BigUint::from(0u64));
}

#[test]
fn from_code_errors_on_invalid_input_with_no_correction() {
    expect_code(from_code("0000000"), ErrorCode::InvalidChecksum);
    expect_code(from_code("!!!!!!!"), ErrorCode::InvalidCharacter);
    // B is not canonical in Medium and is not an alias; no correction guesses it.
    expect_code(from_code("B00000C"), ErrorCode::InvalidCharacter);
    expect_code(from_code(""), ErrorCode::InvalidLength);
}

#[test]
fn from_code_never_attempts_correction() {
    // A code one typo away from a valid code still fails the checksum.
    let c = to_code(123456789u64).unwrap();
    let mut typo: Vec<char> = c.chars().collect();
    typo[1] = if typo[1] == '0' { '1' } else { '0' };
    expect_code(
        from_code(&typo.iter().collect::<String>()),
        ErrorCode::InvalidChecksum,
    );
    // Strict decode options are used under the hood.
    assert_eq!(DecodeOptions::default(), DecodeOptions::strict());
}
