//! Expandable mode tests (spec 19 and the spec 20 test plan): frozen tier
//! shape, boundary round trips, zero ban, checksum-with-zero, no left
//! padding, separator threshold, wrong-generation rejection, the keyed -p
//! tier and mixed-mode interop.

use baseh::{
    baseh_expandable_p_v1, baseh_expandable_v1, baseh_medium_v1, expandable_grouping, Baseh,
    ConfusionProfile, DecodeOptions, ErrorCode, Mode, Permutation, Profile,
};
use num_bigint::BigUint;

const KEY: &[u8] = b"test-only-key-material-0001";
/// The frozen expandable body alphabet (spec 17.1), 27 symbols.
const EXPANDABLE_BODY: &str = "123456789ACDEFGHJKMPQRUVXYZ";

/// A custom expandable profile with no permutation and no blocklist.
fn custom_expandable() -> Profile {
    Profile {
        profile_id: "custom-expandable-test".to_string(),
        mode: Mode::Expandable,
        body_alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".to_string(), // 0/O stripped at preparation
        body_length: 0,
        min_length: Some(3),
        checksum_alphabet: String::new(),
        checksum_length: 1,
        short_checksum_length: 0,
        short_checksum_until: 0,
        case_sensitive: false,
        separator: String::new(),
        separator_min_length: 0,
        grouping: Vec::new(),
        aliases: vec![('O', '0'), ('I', '1'), ('L', '1')],
        permutation: Permutation::Disabled,
        profanity: None,
        max_repetition: 0,
    }
}

fn big(value: u64) -> BigUint {
    BigUint::from(value)
}

fn raw(code: &str) -> String {
    code.chars().filter(|c| *c != '-').collect()
}

fn group_sizes(code: &str) -> Vec<usize> {
    code.split('-').map(|part| part.chars().count()).collect()
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

#[test]
fn frozen_tier_shape() {
    let h = Baseh::new(baseh_expandable_v1()).expect("valid profile");
    assert_eq!(h.profile().mode, Mode::Expandable);
    assert_eq!(h.profile().min_length, Some(4));
    assert_eq!(h.profile().separator_min_length, 6);
    // Spec 22.5: the frozen tier ships the short checksum on, one symbol
    // through total length 5 and two above.
    assert_eq!(h.profile().checksum_length, 2);
    assert_eq!(h.profile().short_checksum_length, 1);
    assert_eq!(h.profile().short_checksum_until, 5);
    // The generation table of spec 22.3 pins the derived alphabets: 27 body
    // symbols (27^(L-effectiveK(L)) per generation), modulus 28 at the short
    // generations and 28^2 = 784 above.
    let expected: [(usize, u64, u64); 5] = [
        (4, 0, 19683),
        (5, 19683, 531441),
        (6, 551124, 531441),
        (7, 1082565, 14348907),
        (8, 15431472, 387420489),
    ];
    for (l, base, cap) in expected {
        assert_eq!(h.generation_base(l), big(base), "generation base {l}");
        assert_eq!(
            h.generation_capacity(l),
            big(cap),
            "generation capacity {l}"
        );
    }
}

#[test]
fn capacity_is_fixed_mode_only() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    expect_error(h.capacity(), ErrorCode::InvalidProfile);
}

#[test]
fn huge_id_fails_fast_out_of_range() {
    // The generation scan is capped at 33 - min_length iterations, so an
    // astronomically large id returns OUT_OF_RANGE immediately instead of
    // looping over ever-larger big integers.
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    let huge = BigUint::from(10u64).pow(100_000);
    let start = std::time::Instant::now();
    expect_error(h.generation_for_id(&huge), ErrorCode::OutOfRange);
    expect_error(h.encode(&huge), ErrorCode::OutOfRange);
    assert!(
        start.elapsed().as_secs() < 5,
        "huge id must fail fast, took {:?}",
        start.elapsed()
    );
}

#[test]
fn rejects_zero_min_length() {
    // JS parity: an explicit 0 is rejected, not coerced to the default of 4.
    let mut p = custom_expandable();
    p.min_length = Some(0);
    expect_error(Baseh::new(p), ErrorCode::InvalidProfile);
}

#[test]
fn boundary_round_trips() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    for l in 4..=8usize {
        let base = h.generation_base(l);
        let next = h.generation_base(l + 1);
        for id in [base.clone(), &next - 1u64, next.clone()] {
            let code = h.encode(&id).expect("boundary id issuable");
            assert_eq!(
                raw(&code).len(),
                h.generation_for_id(&id).unwrap(),
                "length of {id}"
            );
            let d = h.decode(&code, &strict()).expect("boundary id decodes");
            assert_eq!(d.id, id);
            assert_eq!(d.canonical_code, code);
            assert!(!d.corrected);
            // The zero ban makes a non-zero leading body symbol structural.
            let first = raw(&code).chars().next().unwrap();
            assert!(first != '0' && first != 'O');
        }
    }
}

#[test]
fn generation_four_and_five_boundary() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    // With the short checksum on, generation 4 holds 27^3 = 19,683 ids.
    assert_eq!(raw(&h.encode(&big(19682)).unwrap()).len(), 4);
    assert_eq!(raw(&h.encode(&big(19683)).unwrap()).len(), 5);
}

#[test]
fn exhaustive_generation_four_round_trip() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    let mut issued = 0u32;
    for id in 0..19683u64 {
        let code = match h.encode(&big(id)) {
            Ok(code) => code,
            Err(err) => {
                // Blocklisted ids are reserved, never issued (spec 18).
                assert_eq!(err.code, ErrorCode::BlockedCode);
                continue;
            }
        };
        assert_eq!(raw(&code).len(), 4);
        assert_eq!(h.decode(&code, &strict()).unwrap().id, big(id));
        issued += 1;
    }
    assert!(
        issued > 19000,
        "expected nearly all 19683 ids issuable, got {issued}"
    );
}

#[test]
fn custom_profile_boundary_round_trips() {
    let c = Baseh::new(custom_expandable()).unwrap();
    // minLength 3, checksum 1, body 34: generation 3 holds 34^2 = 1156 ids.
    assert_eq!(c.generation_base(3), big(0));
    assert_eq!(c.generation_base(4), big(1156));
    for id in [0u64, 1, 1155, 1156, 40459, 40460] {
        let code = c.encode(&big(id)).unwrap();
        assert_eq!(c.decode(&code, &strict()).unwrap().id, big(id));
    }
    assert_eq!(c.encode(&big(1155)).unwrap().len(), 3);
    assert_eq!(c.encode(&big(1156)).unwrap().len(), 4);
}

#[test]
fn zero_ban_rejections() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    let code = raw(&h.encode(&big(1000)).unwrap());
    let with_zero = format!("0{}", &code[1..]);
    expect_error(h.decode(&with_zero, &strict()), ErrorCode::InvalidCharacter);
    // The typed O aliases to 0 first, then fails the same way.
    let with_o = format!("O{}", &code[1..]);
    expect_error(h.decode(&with_o, &strict()), ErrorCode::InvalidCharacter);
}

#[test]
fn zero_ban_strips_silently() {
    // A custom alphabet containing 0 and O is silently stripped to the same
    // 34-symbol alphabet and validates.
    let c = Baseh::new(custom_expandable()).unwrap();
    assert_eq!(c.generation_capacity(3), big(34 * 34));
    // Body alphabet must not be left with fewer than two symbols.
    let tiny = Profile {
        body_alphabet: "0O".to_string(),
        ..custom_expandable()
    };
    expect_error(Baseh::new(tiny), ErrorCode::InvalidProfile);
}

#[test]
fn checksum_with_zero_round_trips() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    let mut found: Vec<(BigUint, String)> = Vec::new();
    for id in 0..200000u64 {
        if found.len() >= 8 {
            break;
        }
        let Ok(code) = h.encode(&big(id)) else {
            continue;
        };
        if raw(&code)[raw(&code).len() - 2..].contains('0') {
            found.push((big(id), code));
        }
    }
    assert!(
        found.len() >= 8,
        "expected checksum-with-zero codes in the sample"
    );
    for (id, code) in found {
        let d = h.decode(&code, &strict()).unwrap();
        assert_eq!(d.id, id);
        assert_eq!(d.canonical_code, code);
    }
}

#[test]
fn typed_o_in_checksum_position_aliases_to_zero() {
    // Spec 9 defines corrected as canonicalize(input) != canonicalize
    // (canonical), and canonicalize applies aliases — so an aliased input is
    // NOT a correction (same behaviour the fixed-mode tests pin).
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    let mut pinned: Option<(BigUint, String)> = None;
    for id in 0..500000u64 {
        let Ok(code) = h.encode(&big(id)) else {
            continue;
        };
        if raw(&code).ends_with('0') {
            pinned = Some((big(id), code));
            break;
        }
    }
    let (id, code) = pinned.expect("expected a code whose checksum ends in 0");
    let r = raw(&code);
    let typed = format!("{}O", &r[..r.len() - 1]);
    let d = h.decode(&typed, &strict()).unwrap();
    assert_eq!(d.id, id);
    assert_eq!(d.canonical_code, code);
    assert!(!d.corrected);
}

#[test]
fn checksum_detects_substitutions_and_transpositions() {
    // Substitution detection is provably total at every generation (spec
    // 17.1/22.3: the modulus 28 or 784 exceeds 26 and 37 is coprime to both,
    // so no single-symbol delta in 1..26 cancels). Transposition detection is
    // total for the full checksum (modulus 784: gcd(36,784)=4, so escape needs
    // 196 | (a-b), impossible for |a-b| <= 26) but NOT for the short checksum
    // (modulus 28: gcd(36,28)=4, so escape needs 7 | (a-b), which can happen
    // for adjacent body symbols differing by 7, 14 or 21). The sweep pins
    // substitution at generations 4, 6, 8 and transposition at 6 and 8.
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    let alphabet: Vec<char> = EXPANDABLE_BODY.chars().collect();
    for l in [4usize, 6, 8] {
        let base = h.generation_base(l);
        let body_len = l - h.effective_checksum_length(l);
        let mut sub_misses = 0u32;
        let mut trans_misses = 0u32;
        for offset in 0..50u64 {
            let Ok(code) = h.encode(&(&base + big(offset))) else {
                continue;
            };
            let r: Vec<char> = raw(&code).chars().collect();
            for pos in 0..body_len {
                let cur = alphabet.iter().position(|c| *c == r[pos]).unwrap();
                for delta in [1usize, 5, 17] {
                    let mut candidate = r.clone();
                    candidate[pos] = alphabet[(cur + delta) % 27];
                    let candidate: String = candidate.into_iter().collect();
                    if h.decode(&candidate, &strict()).is_ok() {
                        sub_misses += 1;
                    }
                }
            }
            for pos in 0..body_len - 1 {
                if r[pos] == r[pos + 1] {
                    continue;
                }
                let mut swapped = r.clone();
                swapped.swap(pos, pos + 1);
                let swapped: String = swapped.into_iter().collect();
                if h.decode(&swapped, &strict()).is_ok() {
                    trans_misses += 1;
                }
            }
        }
        assert_eq!(sub_misses, 0, "generation {l} had {sub_misses} substitution misses");
        // The short checksum (modulus 28) cannot detect all transpositions;
        // only assert total transposition detection for the full checksum.
        let k = h.effective_checksum_length(l);
        if k == h.profile().checksum_length {
            assert_eq!(trans_misses, 0, "generation {l} had {trans_misses} transposition misses");
        }
    }
}

#[test]
fn no_left_padding() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    expect_error(h.decode("1", &strict()), ErrorCode::InvalidLength);
    expect_error(h.decode("ABC", &strict()), ErrorCode::InvalidLength);
    expect_error(h.decode("", &strict()), ErrorCode::InvalidLength);
    expect_error(
        h.decode(&"A".repeat(33), &strict()),
        ErrorCode::InvalidLength,
    );
    for id in [0u64, 1155, 1156, 40460, 123456789] {
        let code = h.encode(&big(id)).unwrap();
        let d = h.decode(&code, &strict()).unwrap();
        assert_eq!(raw(&d.canonical_code).len(), raw(&code).len());
    }
}

#[test]
fn separator_threshold() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    // Lengths 4 and 5 render bare.
    assert!(!h.encode(&big(0)).unwrap().contains('-'));
    assert!(!h.encode(&big(1156)).unwrap().contains('-'));
    // The decoder rejects a separator below separatorMinLength.
    let code = h.encode(&big(0)).unwrap();
    let with_hyphen = format!("{}-{}", &code[..2], &code[2..]);
    expect_error(
        h.decode(&with_hyphen, &strict()),
        ErrorCode::InvalidCharacter,
    );
    // The pinned shapes for lengths 6 through 10.
    for l in 6..=10usize {
        let id = h.generation_base(l);
        let mut code = None;
        for probe in 0..5000u64 {
            if let Ok(c) = h.encode(&(&id + big(probe))) {
                code = Some(c);
                break;
            }
        }
        let code = code.unwrap_or_else(|| panic!("no issuable id found at generation {l}"));
        assert_eq!(
            group_sizes(&code),
            expandable_grouping(l),
            "generation {l}: {code}"
        );
        assert_eq!(h.decode(&code, &strict()).unwrap().canonical_code, code);
    }
}

#[test]
fn expandable_grouping_is_balanced() {
    // The pinned table of spec 19.5.
    let expected: [(usize, &[usize]); 13] = [
        (4, &[2, 2]),
        (5, &[3, 2]),
        (6, &[3, 3]),
        (7, &[4, 3]),
        (8, &[4, 4]),
        (9, &[5, 4]),
        (10, &[5, 5]),
        (11, &[4, 4, 3]),
        (12, &[4, 4, 4]),
        (13, &[5, 4, 4]),
        (14, &[5, 5, 4]),
        (15, &[5, 5, 5]),
        (16, &[4, 4, 4, 4]),
    ];
    for (l, sizes) in expected {
        assert_eq!(expandable_grouping(l), sizes, "length {l}");
    }
}

#[test]
fn wrong_generation_rejection() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    // A code with a symbol appended fails and never aliases the shorter id.
    let code = raw(&h.encode(&big(777)).unwrap());
    assert_eq!(code.len(), 4);
    for extra in ["1", "A", "Z"] {
        let longer = format!("{code}{extra}"); // 5 symbols: body split moves
        let outcome = h.validate(&longer, &strict());
        assert!(!outcome.valid);
        assert!(
            matches!(
                outcome.reason,
                Some(ErrorCode::InvalidChecksum) | Some(ErrorCode::InvalidCharacter)
            ),
            "unexpected reason {:?}",
            outcome.reason
        );
        expect_error(h.decode(&longer, &strict()), outcome.reason.unwrap());
    }
    // A code with a symbol removed fails.
    let gen6 = h.generation_base(6);
    let mut code = None;
    for probe in 0..1000u64 {
        if let Ok(c) = h.encode(&(&gen6 + big(probe))) {
            code = Some(raw(&c));
            break;
        }
    }
    let code = code.expect("an issuable generation-6 id");
    assert!(!h.validate(&code[1..], &strict()).valid);
}

#[test]
fn correction_stays_within_the_presented_generation() {
    // The medium-safety body drops B, S, T, N, W (and I, L, O), so the
    // Medium confusion pairs (B/D, P/T, M/N, V/W) can no longer fire: their
    // replacements normalize to alias targets that the correction map does
    // not list as sources. C and G both survive in the body, so the Heavy
    // profile's C/G pair is the one spoken-confusion correction that still
    // works against the frozen tier.
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    // Search for a generation-8 id whose code contains C or G in the body.
    let gen8 = h.generation_base(8);
    let mut found: Option<(BigUint, Vec<char>, String)> = None;
    for probe in 0..500_000u64 {
        let id = &gen8 + big(probe);
        let Ok(code) = h.encode(&id) else { continue };
        let r: Vec<char> = raw(&code).chars().collect();
        if r.len() != 8 {
            continue;
        }
        for (pos, ch) in r.iter().enumerate().take(r.len() - 2) {
            if *ch == 'C' || *ch == 'G' {
                let replacement = if *ch == 'C' { 'G' } else { 'C' };
                let mut t = r.clone();
                t[pos] = replacement;
                let typo: String = t.into_iter().collect();
                found = Some((id, r.clone(), typo));
                break;
            }
        }
        if found.is_some() {
            break;
        }
    }
    let (id, r, typo) = found.expect("expected a gen-8 code with C or G in the body");
    let options = DecodeOptions {
        try_correction: true,
        confusion_profile: ConfusionProfile::Heavy,
        max_corrections: 1,
        ..strict()
    };
    let d = h.decode(&typo, &options).unwrap();
    assert_eq!(raw(&d.canonical_code).len(), r.len());
    assert_eq!(d.id, id);
}

#[test]
fn keyed_p_tier_round_trips() {
    let p = Baseh::new(baseh_expandable_p_v1(KEY, "test-01", 0)).unwrap();
    assert_eq!(p.profile().profile_id, "baseh-expandable-p-v1");
    let gen9 = p.generation_base(9);
    for id in [
        big(0),
        big(1),
        big(1155),
        big(1156),
        big(40460),
        big(123456789),
        gen9,
    ] {
        let code = match p.encode(&id) {
            Ok(code) => code,
            Err(err) => {
                assert_eq!(err.code, ErrorCode::BlockedCode);
                continue;
            }
        };
        assert_eq!(p.decode(&code, &strict()).unwrap().id, id);
    }
}

#[test]
fn keyed_p_tier_honours_custom_rounds() {
    let p4 = Baseh::new(baseh_expandable_p_v1(KEY, "test-01", 4)).unwrap();
    let p8 = Baseh::new(baseh_expandable_p_v1(KEY, "test-01", 8)).unwrap();
    let c4 = p4.encode(&big(42)).unwrap();
    assert_eq!(p4.decode(&c4, &strict()).unwrap().id, big(42));
    assert_ne!(c4, p8.encode(&big(42)).unwrap());
}

#[test]
fn keyed_p_tier_differs_from_frozen_key_tier() {
    let frozen = Baseh::new(baseh_expandable_v1()).unwrap();
    let keyed = Baseh::new(baseh_expandable_p_v1(KEY, "test-01", 0)).unwrap();
    assert_ne!(
        frozen.encode(&big(42)).unwrap(),
        keyed.encode(&big(42)).unwrap()
    );
}

#[test]
fn explicit_fixed_mode_behaves_identically() {
    let explicit = Baseh::new(Profile {
        mode: Mode::Fixed,
        ..baseh_medium_v1()
    })
    .unwrap();
    let implicit = Baseh::new(baseh_medium_v1()).unwrap();
    for id in [0u64, 1, 813, 123456789, 481890303] {
        let e = explicit.encode(&big(id));
        let i = implicit.encode(&big(id));
        match (&e, &i) {
            (Ok(e_code), Ok(i_code)) => {
                assert_eq!(e_code, i_code);
                assert_eq!(
                    explicit.decode(e_code, &strict()).unwrap().id,
                    implicit.decode(e_code, &strict()).unwrap().id
                );
            }
            _ => assert!(e.is_err() && i.is_err(), "blocked in both or neither"),
        }
    }
}

#[test]
fn short_code_presented_to_fixed_tier_fails_as_before() {
    let fixed = Baseh::new(baseh_medium_v1()).unwrap();
    let outcome = fixed.validate("ABCD", &strict());
    assert!(!outcome.valid);
    assert_eq!(outcome.reason, Some(ErrorCode::InvalidChecksum)); // re-padded per spec 3.4
}

#[test]
fn expandable_decoder_does_not_sniff_mode_from_input() {
    // The decoder must not guess mode from input: an expandable profile
    // rejects a fixed-tier 8-symbol code on the checksum, per spec 19.7.
    let fixed = Baseh::new(baseh_medium_v1()).unwrap();
    let expandable = Baseh::new(baseh_expandable_v1()).unwrap();
    let fixed_code = fixed.encode(&big(123456789)).unwrap();
    assert!(!expandable.validate(&fixed_code, &strict()).valid);
}

#[test]
fn mode_specific_profile_validation() {
    // The frozen expandable tier carries an empty grouping and validates.
    Baseh::new(baseh_expandable_v1()).expect("expandable tier valid");
    // Grouping is not configurable in expandable mode (spec 19.5).
    expect_error(
        Baseh::new(Profile {
            grouping: vec![4, 4],
            ..baseh_expandable_v1()
        }),
        ErrorCode::InvalidProfile,
    );
    // Fixed still requires the sum.
    expect_error(
        Baseh::new(Profile {
            grouping: vec![3, 3],
            ..baseh_medium_v1()
        }),
        ErrorCode::InvalidProfile,
    );
    // separatorMinLength is expandable-only.
    expect_error(
        Baseh::new(Profile {
            separator_min_length: 6,
            ..baseh_medium_v1()
        }),
        ErrorCode::InvalidProfile,
    );
    // minLength must exceed checksumLength.
    expect_error(
        Baseh::new(Profile {
            min_length: Some(1),
            ..custom_expandable()
        }),
        ErrorCode::InvalidProfile,
    );
}
