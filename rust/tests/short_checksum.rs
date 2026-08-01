//! Short checksum tests (spec 22): frozen tier shape, round trips and the
//! short/normal boundary, effective-K decode, validation, and the spec 22.4
//! interactions.

use baseh::{
    baseh_expandable_p_v1, baseh_expandable_v1, baseh_medium_v1, Baseh, ConfusionProfile,
    DecodeOptions, ErrorCode, Mode, Permutation, Profile,
};
use num_bigint::BigUint;

const KEY: &[u8] = b"test-only-key-material-0001";

fn big(value: u64) -> BigUint {
    BigUint::from(value)
}

fn raw(code: &str) -> String {
    code.chars().filter(|c| *c != '-').collect()
}

fn strict() -> DecodeOptions {
    DecodeOptions::strict()
}

fn expect_error<T>(result: Result<T, baseh::BasehError>, code: ErrorCode) {
    let err = match result {
        Ok(_) => panic!("must fail with {code}"),
        Err(err) => err,
    };
    assert_eq!(err.code, code);
}

/// Find the first issuable id at or after `from`.
fn first_issuable(h: &Baseh, from: &BigUint) -> BigUint {
    for probe in 0..10000u64 {
        let id = from + big(probe);
        if h.encode(&id).is_ok() {
            return id;
        }
    }
    panic!("no issuable id from {from}");
}

#[test]
fn frozen_tier_ships_the_feature_on() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    assert_eq!(h.profile().checksum_length, 2);
    assert_eq!(h.profile().short_checksum_length, 1);
    assert_eq!(h.profile().short_checksum_until, 5);
    let p = Baseh::new(baseh_expandable_p_v1(KEY, "test-01", 0)).unwrap();
    assert_eq!(p.profile().short_checksum_length, 1);
    assert_eq!(p.profile().short_checksum_until, 5);
}

#[test]
fn effective_checksum_length_per_generation() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    assert_eq!(h.effective_checksum_length(4), 1);
    assert_eq!(h.effective_checksum_length(5), 1);
    assert_eq!(h.effective_checksum_length(6), 2);
    assert_eq!(h.effective_checksum_length(8), 2);
}

#[test]
fn generation_capacities_follow_the_effective_k() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    assert_eq!(h.generation_capacity(4), big(39304)); // 34^3
    assert_eq!(h.generation_capacity(5), big(1336336)); // 34^4
    assert_eq!(h.generation_capacity(6), big(1336336)); // one symbol buys the second checksum
    assert_eq!(h.generation_capacity(7), big(45435424));
    assert_eq!(h.generation_capacity(8), big(1544804416));
}

#[test]
fn round_trips_generations_four_through_eight() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    for l in 4..=8usize {
        let first = first_issuable(&h, &h.generation_base(l));
        let last = h.generation_base(l + 1) - 1u64;
        for id in [first, last] {
            let code = match h.encode(&id) {
                Ok(code) => code,
                Err(err) => {
                    assert_eq!(err.code, ErrorCode::BlockedCode, "id {id} blocked");
                    continue;
                }
            };
            assert_eq!(raw(&code).len(), l);
            let d = h.decode(&code, &strict()).unwrap();
            assert_eq!(d.id, id);
            assert_eq!(d.canonical_code, code);
        }
    }
}

#[test]
fn pins_the_short_normal_boundary() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    let last_short = h.generation_base(6) - 1u64; // 1,375,639
    let first_normal = h.generation_base(6); // 1,375,640
    assert_eq!(last_short, big(1375639));
    assert_eq!(first_normal, big(1375640));
    let a = raw(&h.encode(&last_short).unwrap());
    assert_eq!(a.len(), 5);
    assert_eq!(a.len() - 1, 4); // 1 checksum symbol at length 5
    assert_eq!(h.decode(&a, &strict()).unwrap().id, last_short);
    let b = raw(&h.encode(&first_normal).unwrap());
    assert_eq!(b.len(), 6);
    assert_eq!(b.len() - 2, 4); // 2 checksum symbols at length 6
    assert_eq!(h.decode(&b, &strict()).unwrap().id, first_normal);
}

#[test]
fn a_four_character_code_validates_against_exactly_one_checksum_symbol() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    let id = first_issuable(&h, &big(0));
    let code = raw(&h.encode(&id).unwrap());
    assert_eq!(code.len(), 4);
    // Flipping the single checksum symbol fails.
    let check = code.chars().nth(3).unwrap();
    let bad = if check == '0' { '1' } else { '0' };
    let flipped = format!("{}{}", &code[..3], bad);
    expect_error(h.decode(&flipped, &strict()), ErrorCode::InvalidChecksum);
    // Appending a second checksum symbol changes the generation; the split
    // moves and the code fails (spec 19.7), it never validates as gen 4 + 2.
    let appended = format!("{code}{check}");
    expect_error(h.decode(&appended, &strict()), ErrorCode::InvalidChecksum);
}

#[test]
fn short_generations_use_modulus_35_not_1225() {
    // Exactly one of the 35 checksum-alphabet symbols closes a gen-4 body:
    // the modulus is 35, so every symbol is a distinct residue.
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    let id = first_issuable(&h, &big(0));
    let code = raw(&h.encode(&id).unwrap());
    let body = &code[..3];
    let alphabet: String = format!("0{}", "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ");
    let mut hits = 0u32;
    for c in alphabet.chars() {
        if h.decode(&format!("{body}{c}"), &strict()).is_ok() {
            hits += 1;
        }
    }
    assert_eq!(
        hits, 1,
        "exactly one checksum symbol validates a gen-4 body"
    );
}

#[test]
fn separator_threshold_is_still_a_function_of_total_length() {
    // Length 5 renders bare even though its body grew; length 6 splits.
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    assert!(!h.encode(&h.generation_base(5)).unwrap().contains('-'));
    let first6 = first_issuable(&h, &h.generation_base(6));
    let code = h.encode(&first6).unwrap();
    assert!(
        code.chars().nth(3) == Some('-') && code.len() == 7,
        "expected XXX-XXX, got {code}"
    );
}

#[test]
fn repetition_scan_covers_body_plus_the_short_checksum() {
    // Probe with the filter off to find an id whose 4-symbol raw code is a
    // run of 4 (necessarily spanning body and the single checksum symbol),
    // then confirm the frozen tier blocks it.
    let probe = Baseh::new(Profile {
        max_repetition: 0,
        ..baseh_expandable_v1()
    })
    .unwrap();
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    let gen5 = h.generation_base(5);
    let mut found = None;
    let mut id = big(0);
    while id < gen5 {
        if let Ok(code) = probe.encode(&id) {
            let r: Vec<char> = raw(&code).chars().collect();
            if r.len() == 4 && r.windows(4).any(|w| w.iter().all(|c| *c == w[0])) {
                found = Some(id.clone());
                break;
            }
        }
        id += 1u64;
    }
    let found = found.expect("expected a gen-4 code with a run of 4");
    expect_error(h.encode(&found), ErrorCode::BlockedCode);
}

#[test]
fn rejects_the_fields_in_fixed_mode() {
    expect_error(
        Baseh::new(Profile {
            short_checksum_length: 1,
            short_checksum_until: 5,
            ..baseh_medium_v1()
        }),
        ErrorCode::InvalidProfile,
    );
    expect_error(
        Baseh::new(Profile {
            short_checksum_until: 5,
            ..baseh_medium_v1()
        }),
        ErrorCode::InvalidProfile,
    );
}

#[test]
fn rejects_short_checksum_length_at_or_above_checksum_length() {
    for short in [2usize, 3] {
        expect_error(
            Baseh::new(Profile {
                short_checksum_length: short,
                short_checksum_until: 5,
                ..baseh_expandable_v1()
            }),
            ErrorCode::InvalidProfile,
        );
    }
}

#[test]
fn rejects_short_checksum_until_below_min_length() {
    expect_error(
        Baseh::new(Profile {
            short_checksum_length: 1,
            short_checksum_until: 3,
            ..baseh_expandable_v1()
        }),
        ErrorCode::InvalidProfile,
    );
}

#[test]
fn rejects_min_length_at_or_below_short_checksum_length() {
    expect_error(
        Baseh::new(Profile {
            min_length: Some(1),
            short_checksum_length: 1,
            short_checksum_until: 5,
            ..baseh_expandable_v1()
        }),
        ErrorCode::InvalidProfile,
    );
}

#[test]
fn short_checksum_until_alone_is_a_legal_zero_checksum_window() {
    // Spec 22 amendment: the window field is the switch, so until + absent
    // length (0) is the zero-checksum window, not an error.
    let h = Baseh::new(Profile {
        short_checksum_length: 0,
        short_checksum_until: 5,
        ..baseh_expandable_v1()
    })
    .unwrap();
    assert_eq!(h.profile().short_checksum_length, 0);
    assert_eq!(h.effective_checksum_length(4), 0);
}

#[test]
fn rejects_short_checksum_length_without_short_checksum_until() {
    expect_error(
        Baseh::new(Profile {
            short_checksum_length: 1,
            short_checksum_until: 0,
            ..baseh_expandable_v1()
        }),
        ErrorCode::InvalidProfile,
    );
}

#[test]
fn rejects_short_checksum_until_above_8() {
    expect_error(
        Baseh::new(Profile {
            short_checksum_length: 1,
            short_checksum_until: 9,
            ..baseh_expandable_v1()
        }),
        ErrorCode::InvalidProfile,
    );
}

#[test]
fn accepts_short_checksum_until_of_8() {
    let h = Baseh::new(Profile {
        short_checksum_length: 1,
        short_checksum_until: 8,
        ..baseh_expandable_v1()
    })
    .unwrap();
    assert_eq!(h.effective_checksum_length(8), 1);
    assert_eq!(h.effective_checksum_length(9), 2);
}

#[test]
fn zero_turns_the_feature_off_and_keeps_the_old_shape() {
    let off = Baseh::new(Profile {
        short_checksum_length: 0,
        short_checksum_until: 0,
        ..baseh_expandable_v1()
    })
    .unwrap();
    assert_eq!(off.profile().short_checksum_length, 0);
    assert_eq!(off.generation_capacity(4), big(1156));
    assert_eq!(off.effective_checksum_length(4), 2);
    let code = off.encode(&big(1155)).unwrap();
    assert_eq!(raw(&code).len(), 4);
    assert_eq!(off.decode(&code, &strict()).unwrap().id, big(1155));
}

#[test]
fn custom_short_checksum_window_round_trips_at_every_generation() {
    let h = Baseh::new(Profile {
        profile_id: "short-window-test".to_string(),
        mode: Mode::Expandable,
        min_length: Some(4),
        checksum_length: 2,
        short_checksum_length: 1,
        short_checksum_until: 6,
        permutation: Permutation::Disabled,
        profanity: None,
        max_repetition: 0,
        ..baseh_expandable_v1()
    })
    .unwrap();
    // Body sizes: 3, 4, 5 through length 6 (K = 1), then L - 2.
    assert_eq!(h.generation_capacity(4), big(34u64.pow(3)));
    assert_eq!(h.generation_capacity(6), big(34u64.pow(5)));
    assert_eq!(h.generation_capacity(7), big(34u64.pow(5))); // K = 2 kicks in
    assert!(h.generation_capacity(6) > h.generation_capacity(5));
    for l in 4..=8usize {
        let id = h.generation_base(l) + 7u64;
        let code = h.encode(&id).unwrap();
        assert_eq!(raw(&code).len(), l);
        assert_eq!(h.decode(&code, &strict()).unwrap().id, id);
    }
}

/// Zero-checksum window profile: checksumLength 2, short 0, until 5.
fn zero_window_profile() -> Profile {
    Profile {
        profile_id: "short-zero-test".to_string(),
        mode: Mode::Expandable,
        min_length: Some(4),
        checksum_length: 2,
        short_checksum_length: 0,
        short_checksum_until: 5,
        permutation: Permutation::Disabled,
        profanity: None,
        max_repetition: 0,
        ..baseh_expandable_v1()
    }
}

#[test]
fn zero_window_resolves_effective_k_of_zero_inside_checksum_length_above() {
    let h = Baseh::new(zero_window_profile()).unwrap();
    assert_eq!(h.effective_checksum_length(4), 0);
    assert_eq!(h.effective_checksum_length(5), 0);
    assert_eq!(h.effective_checksum_length(6), 2);
}

#[test]
fn zero_window_generations_are_all_body_capacity_is_a_to_the_l() {
    let h = Baseh::new(zero_window_profile()).unwrap();
    assert_eq!(h.generation_capacity(4), big(34u64.pow(4)));
    assert_eq!(h.generation_capacity(5), big(34u64.pow(5)));
    assert_eq!(h.generation_capacity(6), big(34u64.pow(4))); // K = 2 above the window
}

#[test]
fn zero_window_round_trips_generations_four_through_six_with_no_checksum_symbols() {
    let h = Baseh::new(zero_window_profile()).unwrap();
    for l in 4..=6usize {
        for id in [h.generation_base(l), h.generation_base(l + 1) - 1u64] {
            let code = h.encode(&id).unwrap();
            assert_eq!(raw(&code).len(), l);
            assert_eq!(h.decode(&code, &strict()).unwrap().id, id);
            assert_eq!(h.decode(&code, &strict()).unwrap().canonical_code, code);
        }
    }
}

#[test]
fn zero_window_checksum_of_zero_symbols_is_the_empty_string() {
    let h = Baseh::new(zero_window_profile()).unwrap();
    let id = h.generation_base(4);
    let code = raw(&h.encode(&id).unwrap());
    // All body: every symbol of the raw code is a body symbol.
    assert_eq!(code.len(), 4);
    assert!(code
        .chars()
        .all(|c| "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ".contains(c)));
}

#[test]
fn zero_window_typo_is_not_detected_documented_trade_off() {
    let h = Baseh::new(zero_window_profile()).unwrap();
    let id = h.generation_base(4) + 1u64;
    let code = raw(&h.encode(&id).unwrap());
    // Flip the last body symbol to a different body symbol.
    let last = code.chars().nth(3).unwrap();
    let replacement = if last == '1' { '2' } else { '1' };
    let typed = format!("{}{}", &code[..3], replacement);
    let d = h.decode(&typed, &strict()).unwrap(); // no error: there is no checksum to fail
    assert_ne!(d.id, id);
}

#[test]
fn zero_window_correction_never_engages() {
    // With no checksum there is nothing to correct against: any body
    // decodes as-is and try_correction never engages.
    let h = Baseh::new(zero_window_profile()).unwrap();
    let options = DecodeOptions {
        try_correction: true,
        confusion_profile: ConfusionProfile::Heavy,
        max_corrections: 1,
        ..DecodeOptions::default()
    };
    let id = h.generation_base(5) + 3u64;
    let code = raw(&h.encode(&id).unwrap());
    let d = h.decode(&code, &options).unwrap();
    assert_eq!(d.id, id);
    assert!(!d.corrected);
    let last = code.chars().nth(4).unwrap();
    let typed = format!("{}{}", &code[..4], if last == '1' { '2' } else { '1' });
    let d2 = h.decode(&typed, &options).unwrap();
    assert_ne!(d2.id, id);
    assert!(!d2.corrected);
}

#[test]
fn zero_window_repetition_scan_covers_the_whole_all_body_code() {
    let h = Baseh::new(zero_window_profile()).unwrap();
    let filtered = Baseh::new(Profile {
        max_repetition: 4,
        ..zero_window_profile()
    })
    .unwrap();
    let mut found = None;
    let mut id = big(0);
    while id < h.generation_capacity(4) {
        let r: Vec<char> = raw(&h.encode(&id).unwrap()).chars().collect();
        if r.windows(4).any(|w| w.iter().all(|c| *c == w[0])) {
            found = Some(id.clone());
            break;
        }
        id += 1u64;
    }
    let found = found.expect("expected a gen-4 code with a run of 4");
    expect_error(filtered.encode(&found), ErrorCode::BlockedCode);
}

#[test]
fn until_8_window_generation_8_carries_one_checksum_symbol_generation_9_carries_two() {
    let h = Baseh::new(Profile {
        profile_id: "short-until-8-test".to_string(),
        mode: Mode::Expandable,
        min_length: Some(4),
        checksum_length: 2,
        short_checksum_length: 1,
        short_checksum_until: 8,
        permutation: Permutation::Disabled,
        profanity: None,
        max_repetition: 0,
        ..baseh_expandable_v1()
    })
    .unwrap();
    let id8 = h.generation_base(8) + 5u64;
    let c8 = raw(&h.encode(&id8).unwrap());
    assert_eq!(c8.len(), 8);
    assert_eq!(h.effective_checksum_length(8), 1);
    assert_eq!(h.decode(&c8, &strict()).unwrap().id, id8);
    let id9 = h.generation_base(9) + 5u64;
    let c9 = raw(&h.encode(&id9).unwrap());
    assert_eq!(c9.len(), 9);
    assert_eq!(h.effective_checksum_length(9), 2);
    assert_eq!(h.decode(&c9, &strict()).unwrap().id, id9);
}
