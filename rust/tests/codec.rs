//! Layered codec tests: profile validation, boundaries, normalization,
//! aliases, correction, profanity safety, sequential round trips and a
//! fuzz smoke.

use baseh::{
    baseh_heavy_p_v1, baseh_heavy_v1, baseh_light_p_v1, baseh_light_v1, baseh_medium_p_v1,
    baseh_medium_v1, baseh_minimum_p_v1, baseh_minimum_v1, Baseh, ConfusionProfile, DecodeOptions,
    ErrorCode, Mode, Permutation, Profanity, ProfanityMode, Profile, FROZEN_KEY_BYTES,
};
use num_bigint::BigUint;

const KEY: &[u8] = b"test-only-key-material-0001";

fn base_profile() -> Profile {
    Profile {
        profile_id: "test-p".to_string(),
        mode: Mode::Fixed,
        body_alphabet: "0123456789ABCDEFGHJKMNPQRSTVWXYZ".to_string(),
        body_length: 6,
        min_length: 0,
        checksum_alphabet: "234679ACDEFGHJKMNPQRTUVWXY".to_string(),
        checksum_length: 1,
        case_sensitive: false,
        separator: "-".to_string(),
        separator_min_length: 0,
        grouping: vec![3, 3, 1],
        aliases: vec![('O', '0'), ('I', '1'), ('L', '1')],
        permutation: Permutation::Disabled,
        profanity: None,
    }
}

fn no_perm() -> Profile {
    Profile {
        profile_id: "baseh32-noperm-test".to_string(),
        separator: String::new(),
        grouping: Vec::new(),
        ..base_profile()
    }
}

fn perm_test() -> Profile {
    Profile {
        profile_id: "baseh32-perm-test".to_string(),
        permutation: Permutation::FeistelV1 {
            key_id: "test-01".to_string(),
            key_bytes: KEY.to_vec(),
            rounds: 8,
        },
        ..no_perm()
    }
}

fn assert_invalid_profile(profile: Profile, case: &str) {
    let err = match Baseh::new(profile) {
        Ok(_) => panic!("{case} must be rejected"),
        Err(err) => err,
    };
    assert_eq!(err.code, ErrorCode::InvalidProfile, "{case}");
    assert!(!err.safe_for_customer);
}

#[test]
fn profile_validation_rejections() {
    assert_invalid_profile(
        Profile {
            profile_id: String::new(),
            ..base_profile()
        },
        "empty profile id",
    );
    assert_invalid_profile(
        Profile {
            profile_id: "v1\u{2030}".to_string(),
            ..base_profile()
        },
        "non-ascii profile id",
    );
    assert_invalid_profile(
        Profile {
            body_alphabet: "A".to_string(),
            ..base_profile()
        },
        "one-symbol body alphabet",
    );
    assert_invalid_profile(
        Profile {
            body_alphabet: "AAB".to_string(),
            ..base_profile()
        },
        "duplicate body symbols",
    );
    assert_invalid_profile(
        Profile {
            body_alphabet: "AaBCD".to_string(),
            ..base_profile()
        },
        "case collision when case-insensitive",
    );
    assert_invalid_profile(
        Profile {
            body_alphabet: "AB\u{E9}CDE".to_string(),
            ..base_profile()
        },
        "non-ascii body symbol",
    );
    assert_invalid_profile(
        Profile {
            body_length: 0,
            ..base_profile()
        },
        "zero body length",
    );
    assert_invalid_profile(
        Profile {
            body_length: 33,
            ..base_profile()
        },
        "body length above limit",
    );
    assert_invalid_profile(
        Profile {
            checksum_length: 9,
            ..base_profile()
        },
        "checksum length above limit",
    );
    assert_invalid_profile(
        Profile {
            checksum_alphabet: "Z".to_string(),
            ..base_profile()
        },
        "checksum alphabet too small with positive length",
    );
    assert_invalid_profile(
        Profile {
            checksum_alphabet: "AAB".to_string(),
            checksum_length: 1,
            ..base_profile()
        },
        "duplicate checksum symbols",
    );
    assert_invalid_profile(
        Profile {
            separator: "0".to_string(),
            ..base_profile()
        },
        "separator inside body alphabet",
    );
    assert_invalid_profile(
        Profile {
            separator: "A".to_string(),
            ..base_profile()
        },
        "separator inside checksum alphabet",
    );
    assert_invalid_profile(
        Profile {
            aliases: vec![('Q', '*')],
            ..base_profile()
        },
        "alias target not canonical",
    );
    assert_invalid_profile(
        Profile {
            aliases: vec![('Q', 'Q')],
            ..base_profile()
        },
        "alias to itself is not canonical",
    );
    assert_invalid_profile(
        Profile {
            aliases: vec![('&', 'Q'), ('Q', '0')],
            ..base_profile()
        },
        "alias chain",
    );
    assert_invalid_profile(
        Profile {
            aliases: vec![('8', '9'), ('9', '8')],
            ..base_profile()
        },
        "alias cycle (targets are also sources)",
    );
    assert_invalid_profile(
        Profile {
            aliases: vec![('o', '0'), ('O', '0')],
            ..base_profile()
        },
        "duplicate alias source after case normalization",
    );
    assert_invalid_profile(
        Profile {
            grouping: vec![3, 3],
            ..base_profile()
        },
        "group sum mismatch",
    );
    assert_invalid_profile(
        Profile {
            grouping: vec![3, 0, 4],
            ..base_profile()
        },
        "zero group size",
    );
    let mut empty_sep = base_profile();
    empty_sep.separator = String::new();
    empty_sep.grouping = Vec::new();
    Baseh::new(empty_sep).expect("empty separator with empty grouping is valid");
    assert_invalid_profile(
        Profile {
            separator: String::new(),
            grouping: vec![3, 3, 1],
            ..base_profile()
        },
        "grouping with empty separator",
    );
    let mut perm = base_profile();
    perm.permutation = Permutation::FeistelV1 {
        key_id: "k1".to_string(),
        key_bytes: Vec::new(),
        rounds: 8,
    };
    assert_invalid_profile(perm, "missing permutation key");
    let mut perm = base_profile();
    perm.permutation = Permutation::FeistelV1 {
        key_id: String::new(),
        key_bytes: KEY.to_vec(),
        rounds: 8,
    };
    assert_invalid_profile(perm, "empty permutation key id");
    for rounds in [2u32, 5, 7, 18] {
        let mut perm = base_profile();
        perm.permutation = Permutation::FeistelV1 {
            key_id: "k1".to_string(),
            key_bytes: KEY.to_vec(),
            rounds,
        };
        assert_invalid_profile(perm, &format!("rounds {rounds} rejected"));
    }
}

#[test]
fn shipped_profiles_accepted() {
    Baseh::new(baseh_minimum_v1()).expect("baseh-minimum-v1 valid");
    Baseh::new(baseh_light_v1()).expect("baseh-light-v1 valid");
    Baseh::new(baseh_medium_v1()).expect("baseh-medium-v1 valid");
    Baseh::new(baseh_heavy_v1()).expect("baseh-heavy-v1 valid");
    Baseh::new(baseh_minimum_p_v1(KEY, "test-01", 8)).expect("keyed baseh-minimum-p-v1 valid");
    Baseh::new(baseh_light_p_v1(KEY, "test-01", 8)).expect("keyed baseh-light-p-v1 valid");
    Baseh::new(baseh_medium_p_v1(KEY, "test-01", 8)).expect("keyed baseh-medium-p-v1 valid");
    Baseh::new(baseh_heavy_p_v1(KEY, "test-01", 8)).expect("keyed baseh-heavy-p-v1 valid");
}

#[test]
fn frozen_tiers_have_documented_capacities() {
    assert_eq!(
        Baseh::new(baseh_minimum_v1()).unwrap().capacity(),
        &BigUint::from(2_176_782_336u64)
    );
    assert_eq!(
        Baseh::new(baseh_light_v1()).unwrap().capacity(),
        &BigUint::from(887_503_681u64)
    );
    assert_eq!(
        Baseh::new(baseh_medium_v1()).unwrap().capacity(),
        &BigUint::from(481_890_304u64)
    );
    assert_eq!(
        Baseh::new(baseh_heavy_v1()).unwrap().capacity(),
        &BigUint::from(308_915_776u64)
    );
}

#[test]
fn frozen_profile_permutation_shape() {
    // Every plain tier permutes with the frozen published key; only the -p
    // variants take caller key material.
    let frozen = Permutation::FeistelV1 {
        key_id: "frozen".to_string(),
        key_bytes: FROZEN_KEY_BYTES.to_vec(),
        rounds: 8,
    };
    for profile in [
        baseh_minimum_v1(),
        baseh_light_v1(),
        baseh_medium_v1(),
        baseh_heavy_v1(),
    ] {
        assert_eq!(profile.permutation, frozen);
    }
    // The frozen key and a private key scramble differently.
    let frozen_codec = Baseh::new(baseh_medium_v1()).unwrap();
    let private = Baseh::new(baseh_medium_p_v1(KEY, "test-01", 8)).unwrap();
    let options = DecodeOptions::default();
    let id = BigUint::from(123456u64);
    let code = frozen_codec.encode(&id).unwrap();
    assert_eq!(frozen_codec.decode(&code, &options).unwrap().id, id);
    assert_ne!(code, private.encode(&id).unwrap());
    // New frozen shapes: minimum keeps zero checksums at [3, 3]; the rest
    // carry two at [4, 4] with a hyphen delimiter.
    let minimum = baseh_minimum_v1();
    assert_eq!(minimum.checksum_length, 0);
    assert_eq!(minimum.separator, "-");
    assert_eq!(minimum.grouping, vec![3, 3]);
    for profile in [baseh_light_v1(), baseh_medium_v1(), baseh_heavy_v1()] {
        assert_eq!(profile.checksum_length, 2);
        assert_eq!(profile.separator, "-");
        assert_eq!(profile.grouping, vec![4, 4]);
    }
    // The keyed helpers enable feistel-v1 and gain the "-p" profile id.
    assert_eq!(
        baseh_medium_p_v1(KEY, "test-01", 8).permutation,
        Permutation::FeistelV1 {
            key_id: "test-01".to_string(),
            key_bytes: KEY.to_vec(),
            rounds: 8,
        }
    );
    assert_eq!(
        baseh_medium_p_v1(KEY, "test-01", 8).profile_id,
        "baseh-medium-p-v1"
    );
    // Defaults: empty key id and 0 rounds select "default" and 8.
    assert_eq!(
        baseh_light_p_v1(KEY, "", 0).permutation,
        Permutation::FeistelV1 {
            key_id: "default".to_string(),
            key_bytes: KEY.to_vec(),
            rounds: 8,
        }
    );
    // Helpers return fresh values: mutating one does not affect the next.
    let mut p = baseh_medium_v1();
    p.body_length = 5;
    assert_eq!(baseh_medium_v1().body_length, 6);
}

#[test]
fn boundary_round_trips() {
    for profile in [
        no_perm(),
        perm_test(),
        baseh_minimum_v1(),
        baseh_light_v1(),
        baseh_medium_v1(),
        baseh_heavy_v1(),
        baseh_medium_p_v1(KEY, "test-01", 8),
    ] {
        let baseh = Baseh::new(profile).unwrap();
        let cap = baseh.capacity().clone();
        let options = DecodeOptions::default();
        for id in [0u64, 1, 31, 32, 33] {
            round_trip(&baseh, &BigUint::from(id), &options);
        }
        round_trip(&baseh, &(&cap - 2u64), &options);
        round_trip(&baseh, &(&cap - 1u64), &options);
        let err = baseh
            .encode(&cap)
            .expect_err("capacity must be out of range");
        assert_eq!(err.code, ErrorCode::OutOfRange);
        let err = baseh
            .encode(&(&cap + 1u64))
            .expect_err("capacity + 1 must be out of range");
        assert_eq!(err.code, ErrorCode::OutOfRange);
    }
}

fn round_trip(baseh: &Baseh, id: &BigUint, options: &DecodeOptions) {
    let code = baseh.encode(id).unwrap();
    let result = baseh.decode(&code, options).unwrap();
    assert_eq!(result.id, *id, "round trip of {id}");
    assert_eq!(result.canonical_code, code, "canonical stability for {id}");
    assert!(!result.corrected, "canonical input for {id}");
    // Property: encoded length is fixed once separators are removed.
    let p = baseh.profile();
    let raw_len = code.chars().filter(|c| !p.separator.contains(*c)).count();
    assert_eq!(
        raw_len,
        p.body_length + p.checksum_length,
        "fixed length for {id}"
    );
}

#[test]
fn capacity_values() {
    // Medium is the default tier; capacity is exact at 28^6.
    let baseh = Baseh::new(baseh_medium_v1()).unwrap();
    assert_eq!(baseh.capacity(), &BigUint::from(481_890_304u64));

    // Capacity beyond u64 must still work end to end.
    let mut big = base_profile();
    big.profile_id = "big-cap".to_string();
    big.body_length = 20; // 32^20 = 2^100
    big.grouping = vec![10, 11];
    let baseh = Baseh::new(big).unwrap();
    let options = DecodeOptions::default();
    let id = BigUint::from(1u64) << 99usize;
    round_trip(&baseh, &id, &options);
    let cap = baseh.capacity().clone();
    assert_eq!(cap, BigUint::from(1u64) << 100usize);
}

#[test]
fn normalization_and_aliases() {
    let baseh = Baseh::new(no_perm()).unwrap();
    let options = DecodeOptions::default();
    let canonical = baseh.encode(&BigUint::from(1u64)).unwrap();
    let id: BigUint = "1".parse().unwrap();

    // Alias O -> 0 at a body position containing 0.
    assert_eq!(canonical, "000001M");
    let aliased = "O00001M";
    let result = baseh.decode(aliased, &options).unwrap();
    assert_eq!(result.id, id);
    // Aliases are resolved during normalization, so an alias-only difference
    // still decodes as canonical; `corrected` only flags checksum repair.
    assert!(!result.corrected);

    // Case-insensitive input and whitespace trimming (spec 3.1 step 1).
    let result = baseh.decode(" o00001m ", &options).unwrap();
    assert_eq!(result.id, id);
    assert_eq!(baseh.decode("O00001M", &options).unwrap().id, id);

    // Internal spaces rejected unless accepted by the caller.
    let err = baseh
        .decode("O00 001 M", &options)
        .expect_err("internal space rejected in strict mode");
    assert_eq!(err.code, ErrorCode::InvalidCharacter);
    let lenient = baseh
        .decode(
            "O00 001 M",
            &DecodeOptions {
                accept_spaces: true,
                ..DecodeOptions::default()
            },
        )
        .unwrap();
    assert_eq!(lenient.id, id);

    // Aliases in the body region: I normalizes to 1.
    let with_alias = baseh.decode("00000IM", &options).unwrap();
    assert_eq!(with_alias.id, id);

    // Wrong checksum fails; correction with profile None cannot help.
    let err = baseh.decode("000001C", &options).expect_err("bad checksum");
    assert_eq!(err.code, ErrorCode::InvalidChecksum);
    let err = baseh
        .decode(
            "000001C",
            &DecodeOptions {
                try_correction: true,
                ..DecodeOptions::default()
            },
        )
        .expect_err("correction with empty map cannot help");
    assert_eq!(err.code, ErrorCode::InvalidChecksum);

    // Unknown symbol fails as INVALID_CHARACTER before length checks bite.
    let err = baseh.decode("0000@1M", &options).expect_err("bad symbol");
    assert_eq!(err.code, ErrorCode::InvalidCharacter);
    // Spec 3.4: short input is re-padded, then fails the checksum check.
    let err = baseh.decode("000001", &options).expect_err("short input");
    assert_eq!(err.code, ErrorCode::InvalidChecksum);
    // A stripped form of a valid code decodes after re-padding.
    let stripped = baseh.decode("1M", &options).expect("stripped code");
    assert_eq!(stripped.id, id);
    // Re-padding restores the canonical raw code, so corrected stays false.
    assert!(!stripped.corrected);
    // Over-long input still fails as INVALID_LENGTH.
    let err = baseh.decode("0000001M", &options).expect_err("long input");
    assert_eq!(err.code, ErrorCode::InvalidLength);

    // A checksum-only symbol in the body region fails as INVALID_CHARACTER.
    let err = baseh
        .decode("U00000A", &options)
        .expect_err("checksum-only body symbol");
    assert_eq!(err.code, ErrorCode::InvalidCharacter);
}

#[test]
fn formatting_positions() {
    let baseh = Baseh::new(base_profile()).unwrap();
    let code = baseh.encode(&BigUint::from(1u64)).unwrap();
    assert_eq!(code, "000-001-K");
    let chars: Vec<char> = code.chars().collect();
    assert_eq!(chars[3], '-', "separator after group 1");
    assert_eq!(chars[7], '-', "separator after group 2");
    assert_eq!(chars.len(), 9);
}

#[test]
fn correction_light_medium_heavy() {
    let baseh = Baseh::new(no_perm()).unwrap();
    let correct = DecodeOptions {
        accept_spaces: false,
        try_correction: true,
        confusion_profile: ConfusionProfile::Light,
        max_corrections: 1,
    };

    // T/P confusion: canonical 0000PB with checksum C, spoken as 0000TBC.
    let result = baseh.decode("0000TBC", &correct).unwrap();
    assert_eq!(result.canonical_code, "0000PBC");
    assert!(result.corrected);

    // Ambiguity: both one-edit candidates of 0000BT pass checksum 3.
    let err = baseh.decode("0000BT3", &correct).expect_err("ambiguous");
    assert_eq!(err.code, ErrorCode::AmbiguousInput);
    assert!(!err.safe_for_customer, "ambiguity is an internal detail");

    // max_corrections 0 disables correction even when one edit would fix it.
    let err = baseh
        .decode(
            "0000TBC",
            &DecodeOptions {
                max_corrections: 0,
                ..correct.clone()
            },
        )
        .expect_err("max_corrections 0 disables correction");
    assert_eq!(err.code, ErrorCode::InvalidChecksum);

    // Correction never touches the checksum region: flipping a checksum
    // character cannot be repaired by any one-edit body substitution of a
    // body whose checksum already passes.
    let err = baseh
        .decode("0000PBX", &correct)
        .expect_err("checksum region flip not correctable");
    assert_eq!(err.code, ErrorCode::InvalidChecksum);
}

/// Search ids upward for the first whose encoded medium code contains `sym`,
/// skipping blocklist-reserved ids (they are never issued).
fn first_medium_code_with(baseh: &Baseh, sym: char) -> (BigUint, String) {
    for i in 1..5_000_000u64 {
        let id = BigUint::from(i);
        match baseh.encode(&id) {
            Ok(code) => {
                if code.contains(sym) {
                    return (id, code);
                }
            }
            Err(e) if e.code == ErrorCode::BlockedCode => continue,
            Err(e) => panic!("encode {i} failed: {e}"),
        }
    }
    panic!("no medium code contains {sym} in range");
}

#[test]
fn look_alike_aliases_on_frozen_medium() {
    let baseh = Baseh::new(baseh_medium_v1()).unwrap();
    let options = DecodeOptions::default();

    // Typed B decodes as 8 and is not reported as a correction.
    let (id, code) = first_medium_code_with(&baseh, '8');
    let result = baseh.decode(&code.replacen('8', "B", 1), &options).unwrap();
    assert_eq!(result.id, id);
    assert!(!result.corrected);

    // Typed S decodes as 5, uppercase or lowercase.
    let (id, code) = first_medium_code_with(&baseh, '5');
    assert_eq!(
        baseh
            .decode(&code.replacen('5', "S", 1), &options)
            .unwrap()
            .id,
        id
    );
    assert_eq!(
        baseh
            .decode(&code.replacen('5', "s", 1), &options)
            .unwrap()
            .id,
        id
    );

    // A genuinely wrong symbol still fails the checksum.
    let (_, code) = first_medium_code_with(&baseh, '8');
    let err = baseh
        .decode(&code.replacen('8', "7", 1), &options)
        .expect_err("7 is not confusable with 8");
    assert_eq!(err.code, ErrorCode::InvalidChecksum);
}

#[test]
fn medium_encode_never_emits_b_or_s() {
    let baseh = Baseh::new(baseh_medium_v1()).unwrap();
    for i in 0..2000u64 {
        match baseh.encode(&BigUint::from(i)) {
            Ok(code) => assert!(
                !code.contains('B') && !code.contains('S'),
                "code {code} emits B or S"
            ),
            // Blocklisted identifiers are reserved and never issued; skip them.
            Err(e) if e.code == ErrorCode::BlockedCode => continue,
            Err(e) => panic!("encode {i} failed: {e}"),
        }
    }
}

#[test]
fn correction_skips_replacements_outside_the_body_alphabet() {
    // baseh-medium drops B, S and T. A P in the body under confusion light
    // would suggest a T that can never validate; that candidate must be
    // skipped and the failure reported as INVALID_CHECKSUM, never thrown as
    // INVALID_CHARACTER from the checksum step.
    let baseh = Baseh::new(baseh_medium_v1()).unwrap();
    let mut code = String::new();
    for i in 100_000..1_000_000u64 {
        match baseh.encode(&BigUint::from(i)) {
            Ok(c) => {
                if c.contains('P') {
                    code = c;
                    break;
                }
            }
            Err(e) if e.code == ErrorCode::BlockedCode => continue,
            Err(e) => panic!("encode {i} failed: {e}"),
        }
    }
    assert!(code.contains('P'), "no medium code contains P in range");
    let flipped = if code.ends_with('2') { '3' } else { '2' };
    let bad = format!("{}{flipped}", &code[..code.len() - 1]);
    let options = DecodeOptions {
        accept_spaces: false,
        try_correction: true,
        confusion_profile: ConfusionProfile::Light,
        max_corrections: 1,
    };
    let err = baseh
        .decode(&bad, &options)
        .expect_err("wrong checksum symbol with no valid candidates");
    assert_eq!(err.code, ErrorCode::InvalidChecksum);
}

#[test]
fn validate_never_exposes_id() {
    let baseh = Baseh::new(baseh_medium_p_v1(KEY, "test-01", 8)).unwrap();
    let options = DecodeOptions::default();
    let code = baseh.encode(&BigUint::from(7u64)).unwrap();
    let ok = baseh.validate(&code, &options);
    assert!(ok.valid);
    assert_eq!(ok.canonical_code.as_deref(), Some(code.as_str()));
    assert_eq!(ok.reason, None);

    let bad = baseh.validate("0000000", &options);
    assert!(!bad.valid);
    assert_eq!(bad.reason, Some(ErrorCode::InvalidChecksum));
    assert_eq!(bad.canonical_code, None);
    // ValidateOutcome has no id field at all by construction.
}

fn block_profile(mode: ProfanityMode, words: Option<Vec<String>>, extra: Vec<String>) -> Profile {
    Profile {
        profile_id: "test-p-block".to_string(),
        profanity: Some(Profanity {
            mode,
            words,
            extra_words: extra,
        }),
        ..base_profile()
    }
}

#[test]
fn profanity_blocklist_encode() {
    // Default list armed, no custom words.
    let baseh = Baseh::new(block_profile(ProfanityMode::Blocklist, None, vec![])).unwrap();
    let mut blocked = None;
    for n in 0..2_000_000u64 {
        match baseh.encode(&BigUint::from(n)) {
            Ok(code) => {
                let upper = code.to_ascii_uppercase();
                for word in baseh::DEFAULT_BLOCKLIST {
                    assert!(!upper.contains(word), "{code} contains {word}");
                }
            }
            Err(err) => {
                assert_eq!(err.code, ErrorCode::BlockedCode);
                assert!(!err.safe_for_customer);
                blocked = Some(n);
                break;
            }
        }
    }
    assert!(
        blocked.is_some(),
        "default blocklist must bite within 2M ids"
    );

    // Replacement words drop the default list: ZZZZ blocked on body 00ZZZZ.
    let replace = Baseh::new(block_profile(
        ProfanityMode::Blocklist,
        Some(vec!["zzzz".to_string()]),
        vec![],
    ))
    .unwrap();
    let err = replace
        .encode(&BigUint::from(1_048_575u64)) // body 00ZZZZ
        .expect_err("replacement word blocks");
    assert_eq!(err.code, ErrorCode::BlockedCode);

    // extraWords augment the default list.
    let extra = Baseh::new(block_profile(
        ProfanityMode::Blocklist,
        None,
        vec!["zzzz".to_string()],
    ))
    .unwrap();
    let err = extra
        .encode(&BigUint::from(1_048_575u64))
        .expect_err("extra word blocks");
    assert_eq!(err.code, ErrorCode::BlockedCode);

    // Decode may also raise BLOCKED_CODE: a blocked string could never have
    // been issued. The none-mode twin mints it so the checksum matches.
    let open = Baseh::new(Profile {
        profanity: None,
        ..block_profile(ProfanityMode::None, None, vec![])
    })
    .unwrap();
    let code = open.encode(&BigUint::from(1_048_575u64)).unwrap();
    let err = replace
        .decode(&code, &DecodeOptions::default())
        .expect_err("blocked code must not decode");
    assert_eq!(err.code, ErrorCode::BlockedCode);
}

#[test]
fn profanity_blocklist_profile_rules() {
    for bad in ["A", &"Z".repeat(33), "Z1", "Z Z", "ZQ\u{E9}"] {
        assert_invalid_profile(
            block_profile(
                ProfanityMode::Blocklist,
                Some(vec![bad.to_string()]),
                vec![],
            ),
            &format!("blocklist entry {bad:?}"),
        );
    }
    // An empty replacement list arms an empty effective list: nothing blocked.
    let none_blocked = Baseh::new(block_profile(
        ProfanityMode::Blocklist,
        Some(Vec::new()),
        vec![],
    ))
    .unwrap();
    none_blocked
        .encode(&BigUint::from(1_048_575u64))
        .expect("empty replacement list blocks nothing");
}

#[test]
fn profanity_no_vowels() {
    let mut p = base_profile();
    p.profile_id = "novowel-test".to_string();
    p.profanity = Some(Profanity {
        mode: ProfanityMode::NoVowels,
        words: None,
        extra_words: vec![],
    });
    p.separator = String::new();
    p.grouping = Vec::new();
    let baseh = Baseh::new(p).unwrap();
    // Body alphabet 32 - {A,E} = 30; capacity 30^6 (the checksum alphabet
    // loses A,E,U but leaves body capacity unchanged).
    assert_eq!(baseh.capacity(), &BigUint::from(729_000_000u64));

    let options = DecodeOptions::default();
    round_trip(&baseh, &BigUint::from(0u64), &options);
    round_trip(&baseh, &BigUint::from(728_999_999u64), &options);

    // Encoder output never contains a vowel.
    for n in [0u64, 1, 1000, 728_999_999] {
        let code = baseh.encode(&BigUint::from(n)).unwrap();
        assert!(!code
            .chars()
            .any(|c| matches!(c, 'A' | 'E' | 'I' | 'O' | 'U')));
    }

    // A vowel in input is just another invalid character.
    let err = baseh
        .decode("0000A02", &options)
        .expect_err("vowel input rejected");
    assert_eq!(err.code, ErrorCode::InvalidCharacter);

    // Stripping below two symbols is an invalid profile. Body "AB" loses A.
    assert_invalid_profile(
        Profile {
            profile_id: "novowel-tiny".to_string(),
            mode: Mode::Fixed,
            body_alphabet: "AB".to_string(),
            body_length: 4,
            min_length: 0,
            checksum_alphabet: "234679ACDEFGHJKMNPQRTUVWXY".to_string(),
            checksum_length: 0,
            case_sensitive: false,
            separator: String::new(),
            separator_min_length: 0,
            grouping: Vec::new(),
            aliases: vec![],
            permutation: Permutation::Disabled,
            profanity: Some(Profanity {
                mode: ProfanityMode::NoVowels,
                words: None,
                extra_words: vec![],
            }),
        },
        "no-vowels leaves body alphabet with one symbol",
    );
}

#[test]
fn error_code_serialized_names() {
    assert_eq!(ErrorCode::BlockedCode.to_string(), "BLOCKED_CODE");
    assert_eq!(
        "BLOCKED_CODE".parse::<ErrorCode>(),
        Ok(ErrorCode::BlockedCode)
    );
    assert_eq!(ErrorCode::InvalidChecksum.to_string(), "INVALID_CHECKSUM");
}

#[test]
fn sequential_round_trip_smoke() {
    let baseh = Baseh::new(perm_test()).unwrap();
    let options = DecodeOptions::default();
    let mut seen = std::collections::HashSet::new();
    for n in 0..10_000u64 {
        let id = BigUint::from(n);
        let code = baseh.encode(&id).unwrap();
        assert!(seen.insert(code.clone()), "duplicate code for {n}");
        let result = baseh.decode(&code, &options).unwrap();
        assert_eq!(result.id, id, "sequential round trip {n}");
        // Encoder only emits canonical symbols: never O, I or L.
        for ch in code.chars() {
            assert!(!matches!(ch, 'O' | 'I' | 'L'), "alias source emitted");
        }
    }
}

/// Fixed-seed xorshift64(*) generator for reproducible fuzz runs.
struct XorShift(u64);

impl XorShift {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

#[test]
fn fuzz_smoke() {
    let profiles = [
        Baseh::new(no_perm()).unwrap(),
        Baseh::new(perm_test()).unwrap(),
        Baseh::new(baseh_medium_p_v1(KEY, "test-01", 8)).unwrap(),
    ];
    let mut rng = XorShift(0x243F_6A88_85A3_08D3);
    let options = DecodeOptions::default();
    let mut ok_count = 0usize;
    for _ in 0..20_000 {
        let len = rng.below(24) as usize;
        // Printable ASCII plus stray non-ASCII code points: anything the API
        // may legally receive must produce Ok or BasehError, never a panic.
        let input: String = (0..len)
            .map(|_| match rng.below(32) {
                0 => char::from_u32(0xE9).unwrap(), // e-acute: non-ASCII
                1 => '\t',
                2 => '\x0B',
                3 => ' ',
                n => char::from_u32(0x20 + (n as u32) % 95).unwrap(),
            })
            .collect();
        let baseh = &profiles[rng.below(3) as usize];
        match baseh.decode(&input, &options) {
            Ok(result) => {
                ok_count += 1;
                assert!(result.id < *baseh.capacity(), "decoded id in range");
                // Canonical stability: re-encoding reproduces the reporting code.
                assert_eq!(baseh.encode(&result.id).unwrap(), result.canonical_code);
            }
            Err(err) => {
                // All nine codes are legal; the point is that it IS a BasehError.
                let _ = err.code.as_str();
            }
        }
        // validate mirrors decode exactly.
        let outcome = baseh.validate(&input, &options);
        assert_eq!(outcome.valid, baseh.decode(&input, &options).is_ok());
    }
    // Random garbage should almost never decode; a huge success count means
    // something is accepting everything.
    assert!(
        ok_count < 500,
        "suspiciously high fuzz success count {ok_count}"
    );
}
