//! Spec 12.5 `inspect` tests: every state, fixed and expandable prefixes,
//! aliases while typing, whitespace, over-length, and the spec 3.4
//! padded-prefix false-green case. Mirrors js/test/inspect.test.ts.

use baseh::{
    baseh_expandable_v1, baseh_heavy_v1, baseh_medium_v1, baseh_minimum_v1, Baseh, DecodeOptions,
    ErrorCode, InspectResult, Permutation, Profile,
};
use num_bigint::BigUint;

fn medium() -> Baseh {
    // fixed, expected 8, grouping [4, 4]
    Baseh::new(baseh_medium_v1()).unwrap()
}

fn expandable() -> Baseh {
    // minLength 4, separatorMinLength 6
    Baseh::new(baseh_expandable_v1()).unwrap()
}

/// Filter-free medium clone, so scans are not disturbed by the blocklist or
/// repetition filter.
fn medium_clone() -> Baseh {
    Baseh::new(Profile {
        profanity: None,
        max_repetition: 0,
        ..baseh_medium_v1()
    })
    .unwrap()
}

fn strip_separators(code: &str) -> String {
    code.chars().filter(|c| *c != '-').collect()
}

fn typing_of(result: &InspectResult) -> (String, f64) {
    match result {
        InspectResult::Typing { typed, progress } => (typed.clone(), *progress),
        other => panic!("expected typing, got {other:?}"),
    }
}

mod fixed_mode {
    use super::*;

    #[test]
    fn empty_states() {
        let baseh = medium();
        assert_eq!(baseh.inspect(""), InspectResult::Empty);
        assert_eq!(baseh.inspect("   "), InspectResult::Empty);
        assert_eq!(baseh.inspect(" - \t"), InspectResult::Empty);
    }

    #[test]
    fn typing_prefixes_carry_normalized_symbols_and_progress() {
        let baseh = medium();
        let canonical = baseh.encode(&BigUint::from(123_456_789u64)).unwrap();
        let raw = strip_separators(&canonical);
        for n in 1..8 {
            let result = baseh.inspect(&raw[..n]);
            let (typed, progress) = typing_of(&result);
            assert_eq!(typed.replace('-', ""), raw[..n], "prefix {n}");
            assert_eq!(progress, n as f64 / 8.0, "prefix {n}");
        }
        // separators inserted as far as the groups go (grouping [4, 4])
        let (typed, _) = typing_of(&baseh.inspect(&raw[..5]));
        assert_eq!(typed, format!("{}-{}", &raw[..4], &raw[4..5]));
    }

    #[test]
    fn typing_normalizes_lowercase_and_aliases() {
        let baseh = medium();
        let canonical = baseh.encode(&BigUint::from(123_456_789u64)).unwrap();
        let raw = strip_separators(&canonical);
        let (typed, _) = typing_of(&baseh.inspect(&raw[..5].to_lowercase()));
        assert_eq!(typed, format!("{}-{}", &raw[..4], &raw[4..5]));
        // alias source typed mid-code normalizes to its target (O -> 0 etc.)
        let alias_profile = Baseh::new(Profile {
            permutation: Permutation::Disabled,
            profanity: None,
            max_repetition: 0,
            ..baseh_medium_v1()
        })
        .unwrap();
        let (typed, _) = typing_of(&alias_profile.inspect("OIL"));
        assert_eq!(typed, "011");
    }

    #[test]
    fn typing_ignores_whitespace_and_stray_separators_for_counting() {
        let baseh = medium();
        let canonical = baseh.encode(&BigUint::from(123_456_789u64)).unwrap();
        let raw = strip_separators(&canonical);
        let messy = format!(" {} -{}\t", &raw[..2], &raw[2..5]);
        let (typed, _) = typing_of(&baseh.inspect(&messy));
        assert_eq!(typed.replace('-', ""), raw[..5]);
    }

    #[test]
    fn padded_prefix_passing_checksum_still_reports_typing() {
        // Spec 3.4: find a short input whose re-padded form validates (the
        // cookbook's "false green"), on a filter-free clone so the scan is
        // not disturbed by the blocklist or repetition filter.
        let clone = medium_clone();
        let options = DecodeOptions::default();
        let mut found: Option<String> = None;
        for id in 0..200_000u64 {
            let raw = strip_separators(&clone.encode(&BigUint::from(id)).unwrap());
            let stripped = raw.trim_start_matches('0');
            // The JS regex /^0+(?=.)/ keeps at least one symbol.
            let stripped = if stripped.is_empty() {
                &raw[raw.len() - 1..]
            } else {
                stripped
            };
            if stripped.len() < raw.len()
                && stripped.len() >= 2
                && clone.validate(stripped, &options).valid
            {
                found = Some(stripped.to_string());
                break;
            }
        }
        let found = found.expect("no false-green prefix found in scan window");
        assert_eq!(medium().inspect(&found).state(), "typing");
    }

    #[test]
    fn valid_complete_code_with_id_and_canonical_code() {
        let baseh = medium();
        let canonical = baseh.encode(&BigUint::from(123_456_789u64)).unwrap();
        let expected = InspectResult::Valid {
            id: BigUint::from(123_456_789u64),
            canonical_code: canonical.clone(),
        };
        assert_eq!(baseh.inspect(&canonical), expected);
        // no separators, lowercase, surrounding whitespace all reach valid
        let messy = format!(" {} ", strip_separators(&canonical).to_lowercase());
        assert_eq!(baseh.inspect(&messy), expected);
    }

    #[test]
    fn valid_alias_typed_complete_code_decodes() {
        let clone = medium_clone();
        // find a code containing 8, type it with B (B -> 8)
        for id in 1..100_000u64 {
            let raw = strip_separators(&clone.encode(&BigUint::from(id)).unwrap());
            if raw.contains('8') {
                let result = clone.inspect(&raw.replacen('8', "B", 1));
                match result {
                    InspectResult::Valid { id: got, .. } => {
                        assert_eq!(got, BigUint::from(id));
                        return;
                    }
                    other => panic!("expected valid, got {other:?}"),
                }
            }
        }
        panic!("no code containing 8 found");
    }

    #[test]
    fn invalid_complete_code_with_wrong_checksum_carries_reason() {
        let baseh = medium();
        let canonical = baseh.encode(&BigUint::from(77u64)).unwrap();
        let raw = strip_separators(&canonical);
        let bad_check = if &raw[6..7] == "2" { "3" } else { "2" };
        let bad = format!("{}{}{}", &raw[..6], bad_check, &raw[7..]);
        assert_eq!(
            baseh.inspect(&bad),
            InspectResult::Invalid {
                reason: ErrorCode::InvalidChecksum
            }
        );
    }

    #[test]
    fn bad_char_outside_both_alphabets_typing_or_complete() {
        let baseh = medium();
        assert_eq!(baseh.inspect("12@"), InspectResult::BadChar);
        assert_eq!(baseh.inspect("1234-56@8"), InspectResult::BadChar);
    }

    #[test]
    fn checksum_only_symbol_in_body_region_is_invalid_not_bad_char() {
        // U is in the Heavy checksum alphabet but not its body alphabet: it
        // passes the union-membership gate and fails under validate, exactly
        // like the shared error vector (heavy "U00000A" -> INVALID_CHARACTER).
        let heavy = Baseh::new(baseh_heavy_v1()).unwrap();
        assert_eq!(
            heavy.inspect("U000000A"),
            InspectResult::Invalid {
                reason: ErrorCode::InvalidCharacter
            }
        );
    }

    #[test]
    fn too_long_beyond_body_plus_checksum_length() {
        let baseh = medium();
        assert_eq!(baseh.inspect("00000000C"), InspectResult::TooLong);
        assert_eq!(baseh.inspect("0000-0000-C"), InspectResult::TooLong);
    }

    #[test]
    fn no_checksum_fixed_profile_every_complete_length_validates() {
        let minimum = Baseh::new(baseh_minimum_v1()).unwrap(); // 6 symbols, no checksum
        let canonical = minimum.encode(&BigUint::from(42u64)).unwrap();
        assert_eq!(minimum.inspect(&canonical).state(), "valid");
        assert_eq!(minimum.inspect(&canonical[..3]).state(), "typing");
    }
}

mod expandable_mode {
    use super::*;

    #[test]
    fn empty_and_below_min_length_typing() {
        let baseh = expandable();
        assert_eq!(baseh.inspect(""), InspectResult::Empty);
        assert_eq!(
            baseh.inspect("1"),
            InspectResult::Typing {
                typed: "1".to_string(),
                progress: 0.25
            }
        );
        assert_eq!(
            baseh.inspect("12"),
            InspectResult::Typing {
                typed: "12".to_string(),
                progress: 0.5
            }
        );
        assert_eq!(
            baseh.inspect("123"),
            InspectResult::Typing {
                typed: "123".to_string(),
                progress: 0.75
            }
        );
        // below separatorMinLength the typing render is bare
        assert_eq!(
            baseh.inspect("ab"),
            InspectResult::Typing {
                typed: "A8".to_string(),
                progress: 0.5
            }
        );
        // aliases normalize while typing (O -> 0, a checksum-alphabet symbol)
        assert_eq!(
            baseh.inspect("O"),
            InspectResult::Typing {
                typed: "0".to_string(),
                progress: 0.25
            }
        );
    }

    #[test]
    fn generation_boundaries_min_length_is_first_complete_length() {
        let baseh = expandable();
        let code4 = baseh.encode(&BigUint::from(0u64)).unwrap(); // generation 4
        assert_eq!(code4.len(), 4);
        assert_eq!(
            baseh.inspect(&code4),
            InspectResult::Valid {
                id: BigUint::from(0u64),
                canonical_code: code4
            }
        );
        let code5 = baseh.encode(&BigUint::from(19_683u64)).unwrap(); // generation 5
        assert_eq!(code5.len(), 5);
        assert_eq!(
            baseh.inspect(&code5),
            InspectResult::Valid {
                id: BigUint::from(19_683u64),
                canonical_code: code5
            }
        );
        // first id of generation 6, renders with a hyphen
        let code6 = baseh.encode(&BigUint::from(551_124u64)).unwrap();
        assert_eq!(code6.len(), 7);
        assert_eq!(
            baseh.inspect(&code6),
            InspectResult::Valid {
                id: BigUint::from(551_124u64),
                canonical_code: code6
            }
        );
    }

    #[test]
    fn every_length_at_or_above_min_length_is_complete() {
        // a bad checksum is invalid, not typing
        let baseh = expandable();
        let sample = strip_separators(&baseh.encode(&BigUint::from(777u64)).unwrap()); // gen 4
        let five = format!("{sample}A"); // wrong generation-5 checksum (spec 19.7)
        assert_eq!(
            baseh.inspect(&five),
            InspectResult::Invalid {
                reason: ErrorCode::InvalidChecksum
            }
        );
    }

    #[test]
    fn zero_or_o_in_body_position_is_invalid_character() {
        let baseh = expandable();
        let sample = strip_separators(&baseh.encode(&BigUint::from(777u64)).unwrap());
        for bad in [format!("0{}", &sample[1..]), format!("O{}", &sample[1..])] {
            assert_eq!(
                baseh.inspect(&bad),
                InspectResult::Invalid {
                    reason: ErrorCode::InvalidCharacter
                }
            );
        }
    }

    #[test]
    fn bad_char_and_too_long() {
        let baseh = expandable();
        assert_eq!(baseh.inspect("A@"), InspectResult::BadChar);
        assert_eq!(baseh.inspect("ABCD@"), InspectResult::BadChar);
        assert_eq!(baseh.inspect(&"A".repeat(33)), InspectResult::TooLong);
        // 32 real symbols pass the length gate and land on validate
        assert_eq!(baseh.inspect(&"A".repeat(32)).state(), "invalid");
    }

    #[test]
    fn whitespace_and_separators_in_complete_code_still_reach_valid() {
        let baseh = expandable();
        let code6 = baseh.encode(&BigUint::from(551_124u64)).unwrap();
        let raw = strip_separators(&code6);
        let messy = format!(" {} - {}", &raw[..3], &raw[3..]);
        assert_eq!(
            baseh.inspect(&messy),
            InspectResult::Valid {
                id: BigUint::from(551_124u64),
                canonical_code: code6
            }
        );
    }
}

#[test]
fn zero_config_facade_matches_default_profile_instance() {
    let expandable = expandable();
    let mut inputs = vec![
        "".to_string(),
        "1".to_string(),
        "AB@".to_string(),
        "A".repeat(33),
    ];
    inputs.push(expandable.encode(&BigUint::from(42u64)).unwrap());
    for input in &inputs {
        assert_eq!(
            baseh::inspect(input),
            expandable.inspect(input),
            "{input:?}"
        );
    }
    let code = expandable.encode(&BigUint::from(42u64)).unwrap();
    assert_eq!(baseh::inspect(&code).state(), "valid");
}
