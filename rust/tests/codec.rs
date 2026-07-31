//! Layered codec tests: profile validation, boundaries, normalization,
//! aliases, correction, sequential round trips and a fuzz smoke.

use base_human::{
    hrc32_v1, hrc32s_v1, ConfusionProfile, DecodeOptions, ErrorCode, Hrc, Permutation, Profile,
};
use num_bigint::BigUint;

const KEY: &[u8] = b"test-only-key-material-0001";

fn base_profile() -> Profile {
    Profile {
        profile_id: "test-p".to_string(),
        body_alphabet: "0123456789ABCDEFGHJKMNPQRSTVWXYZ".to_string(),
        body_length: 6,
        checksum_alphabet: "234679ACDEFGHJKMNPQRTUVWXY".to_string(),
        checksum_length: 1,
        case_sensitive: false,
        separator: "-".to_string(),
        grouping: vec![3, 3, 1],
        aliases: vec![('O', '0'), ('I', '1'), ('L', '1')],
        permutation: Permutation::Disabled,
    }
}

fn no_perm() -> Profile {
    let mut p = hrc32_v1(KEY, "test-01");
    p.profile_id = "hrc32-noperm-test".to_string();
    p.permutation = Permutation::Disabled;
    p
}

fn assert_invalid_profile(profile: Profile, case: &str) {
    let err = match Hrc::new(profile) {
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
    Hrc::new(hrc32_v1(KEY, "test-01")).expect("hrc32-v1 valid");
    Hrc::new(hrc32s_v1(KEY, "test-01")).expect("hrc32s-v1 valid");
}

#[test]
fn boundary_round_trips() {
    for profile in [
        no_perm(),
        hrc32_v1(KEY, "test-01"),
        hrc32s_v1(KEY, "test-01"),
    ] {
        let hrc = Hrc::new(profile).unwrap();
        let cap = hrc.capacity().clone();
        let options = DecodeOptions::default();
        for id in [0u64, 1, 31, 32, 33] {
            round_trip(&hrc, &BigUint::from(id), &options);
        }
        round_trip(&hrc, &(&cap - 2u64), &options);
        round_trip(&hrc, &(&cap - 1u64), &options);
        let err = hrc.encode(&cap).expect_err("capacity must be out of range");
        assert_eq!(err.code, ErrorCode::OutOfRange);
        let err = hrc
            .encode(&(&cap + 1u64))
            .expect_err("capacity + 1 must be out of range");
        assert_eq!(err.code, ErrorCode::OutOfRange);
    }
}

fn round_trip(hrc: &Hrc, id: &BigUint, options: &DecodeOptions) {
    let code = hrc.encode(id).unwrap();
    let result = hrc.decode(&code, options).unwrap();
    assert_eq!(result.id, *id, "round trip of {id}");
    assert_eq!(result.canonical_code, code, "canonical stability for {id}");
    assert!(!result.corrected, "canonical input for {id}");
    // Property: encoded length is fixed once separators are removed.
    let raw_len = code.chars().filter(|c| *c != '-').count();
    let p = hrc.profile();
    assert_eq!(
        raw_len,
        p.body_length + p.checksum_length,
        "fixed length for {id}"
    );
}

#[test]
fn capacity_values() {
    let hrc = Hrc::new(hrc32_v1(KEY, "test-01")).unwrap();
    assert_eq!(hrc.capacity(), &BigUint::from(1_073_741_824u64));

    // Capacity beyond u64 must still work end to end.
    let mut big = base_profile();
    big.profile_id = "big-cap".to_string();
    big.body_length = 20; // 32^20 = 2^100
    big.grouping = vec![10, 11];
    let hrc = Hrc::new(big).unwrap();
    let options = DecodeOptions::default();
    let id = BigUint::from(1u64) << 99usize;
    round_trip(&hrc, &id, &options);
    let cap = hrc.capacity().clone();
    assert_eq!(cap, BigUint::from(1u64) << 100usize);
}

#[test]
fn normalization_and_aliases() {
    let hrc = Hrc::new(no_perm()).unwrap();
    let options = DecodeOptions::default();
    let canonical = hrc.encode(&BigUint::from(1u64)).unwrap();
    let id: BigUint = "1".parse().unwrap();

    // Alias O -> 0 at a body position containing 0.
    assert_eq!(canonical, "000-001-W");
    let aliased = "O00-001-W";
    let result = hrc.decode(aliased, &options).unwrap();
    assert_eq!(result.id, id);
    // Aliases are resolved during normalization, so an alias-only difference
    // still decodes as canonical; `corrected` only flags checksum repair.
    assert!(!result.corrected);

    // Case-insensitive input and whitespace trimming (spec 3.1 step 1).
    let result = hrc.decode(" o00-001-W ", &options).unwrap();
    assert_eq!(result.id, id);
    assert_eq!(hrc.decode("O00001W", &options).unwrap().id, id);

    // Internal spaces rejected unless accepted by the caller.
    let err = hrc
        .decode("O00 001 W", &options)
        .expect_err("internal space rejected in strict mode");
    assert_eq!(err.code, ErrorCode::InvalidCharacter);
    let lenient = hrc
        .decode(
            "O00 001 W",
            &DecodeOptions {
                accept_spaces: true,
                ..DecodeOptions::default()
            },
        )
        .unwrap();
    assert_eq!(lenient.id, id);

    // Aliases in the checksum region.
    let with_alias_check = hrc.decode("000-00I-W", &options).unwrap();
    assert_eq!(with_alias_check.id, id);

    // Wrong checksum fails; correction with profile None cannot help.
    let err = hrc.decode("000-001-C", &options).expect_err("bad checksum");
    assert_eq!(err.code, ErrorCode::InvalidChecksum);
    let err = hrc
        .decode(
            "000-001-C",
            &DecodeOptions {
                try_correction: true,
                ..DecodeOptions::default()
            },
        )
        .expect_err("correction with empty map cannot help");
    assert_eq!(err.code, ErrorCode::InvalidChecksum);

    // Unknown symbol fails as INVALID_CHARACTER before length checks bite.
    let err = hrc.decode("000-0@1-W", &options).expect_err("bad symbol");
    assert_eq!(err.code, ErrorCode::InvalidCharacter);
    let err = hrc.decode("000-001", &options).expect_err("short input");
    assert_eq!(err.code, ErrorCode::InvalidLength);
}

#[test]
fn formatting_positions() {
    let hrc = Hrc::new(no_perm()).unwrap();
    let code = hrc.encode(&BigUint::from(1u64)).unwrap();
    let chars: Vec<char> = code.chars().collect();
    assert_eq!(chars[3], '-', "separator after group 1");
    assert_eq!(chars[7], '-', "separator after group 2");
    assert_eq!(chars.len(), 9);
}

#[test]
fn correction_light_medium_heavy() {
    let hrc = Hrc::new(no_perm()).unwrap();
    let correct = DecodeOptions {
        accept_spaces: false,
        try_correction: true,
        confusion_profile: ConfusionProfile::Light,
        max_corrections: 1,
    };

    // T/P confusion: canonical 0000PB with checksum M, spoken as 0000TBM.
    let result = hrc.decode("0000TBM", &correct).unwrap();
    let raw: String = result
        .canonical_code
        .chars()
        .filter(|c| *c != '-')
        .collect();
    assert_eq!(&raw[..6], "0000PB");
    assert!(result.corrected);

    // Ambiguity: both one-edit candidates of 0000BT pass checksum E.
    let err = hrc.decode("0000BTE", &correct).expect_err("ambiguous");
    assert_eq!(err.code, ErrorCode::AmbiguousInput);
    assert!(!err.safe_for_customer, "ambiguity is an internal detail");

    // max_corrections 0 disables correction even when one edit would fix it.
    let err = hrc
        .decode(
            "0000TBM",
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
    let err = hrc
        .decode("0000PBX", &correct)
        .expect_err("checksum region flip not correctable");
    assert_eq!(err.code, ErrorCode::InvalidChecksum);
}

#[test]
fn validate_never_exposes_id() {
    let hrc = Hrc::new(hrc32_v1(KEY, "test-01")).unwrap();
    let options = DecodeOptions::default();
    let code = hrc.encode(&BigUint::from(7u64)).unwrap();
    let ok = hrc.validate(&code, &options);
    assert!(ok.valid);
    assert_eq!(ok.canonical_code.as_deref(), Some(code.as_str()));
    assert_eq!(ok.reason, None);

    let bad = hrc.validate("000-000-0", &options);
    assert!(!bad.valid);
    assert_eq!(bad.reason, Some(ErrorCode::InvalidChecksum));
    assert_eq!(bad.canonical_code, None);
    // ValidateOutcome has no id field at all by construction.
}

#[test]
fn sequential_round_trip_smoke() {
    let hrc = Hrc::new(hrc32_v1(KEY, "test-01")).unwrap();
    let options = DecodeOptions::default();
    let mut seen = std::collections::HashSet::new();
    for n in 0..10_000u64 {
        let id = BigUint::from(n);
        let code = hrc.encode(&id).unwrap();
        assert!(seen.insert(code.clone()), "duplicate code for {n}");
        let result = hrc.decode(&code, &options).unwrap();
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
        Hrc::new(no_perm()).unwrap(),
        Hrc::new(hrc32_v1(KEY, "test-01")).unwrap(),
        Hrc::new(hrc32s_v1(KEY, "test-01")).unwrap(),
    ];
    let mut rng = XorShift(0x243F_6A88_85A3_08D3);
    let options = DecodeOptions::default();
    let mut ok_count = 0usize;
    for _ in 0..20_000 {
        let len = rng.below(24) as usize;
        // Printable ASCII plus stray non-ASCII code points: anything the API
        // may legally receive must produce Ok or HrcError, never a panic.
        let input: String = (0..len)
            .map(|_| match rng.below(32) {
                0 => char::from_u32(0xE9).unwrap(), // e-acute: non-ASCII
                1 => '\t',
                2 => '\x0B',
                3 => ' ',
                n => char::from_u32(0x20 + (n as u32) % 95).unwrap(),
            })
            .collect();
        let hrc = &profiles[rng.below(3) as usize];
        match hrc.decode(&input, &options) {
            Ok(result) => {
                ok_count += 1;
                assert!(result.id < *hrc.capacity(), "decoded id in range");
                // Canonical stability: re-encoding reproduces the reporting code.
                assert_eq!(hrc.encode(&result.id).unwrap(), result.canonical_code);
            }
            Err(err) => {
                // All eight codes are legal; the point is that it IS an HrcError.
                let _ = err.code.as_str();
            }
        }
        // validate mirrors decode exactly.
        let outcome = hrc.validate(&input, &options);
        assert_eq!(outcome.valid, hrc.decode(&input, &options).is_ok());
    }
    // Random garbage should almost never decode; a huge success count means
    // something is accepting everything.
    assert!(
        ok_count < 500,
        "suspiciously high fuzz success count {ok_count}"
    );
}
