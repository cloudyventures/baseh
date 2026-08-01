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
/// The frozen expandable body alphabet (spec 17.1), 34 symbols.
const EXPANDABLE_BODY: &str = "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ";

/// A custom expandable profile with no permutation and no blocklist.
fn custom_expandable() -> Profile {
    Profile {
        profile_id: "custom-expandable-test".to_string(),
        mode: Mode::Expandable,
        body_alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".to_string(), // 0/O stripped at preparation
        body_length: 0,
        min_length: 3,
        checksum_alphabet: String::new(),
        checksum_length: 1,
        case_sensitive: false,
        separator: String::new(),
        separator_min_length: 0,
        grouping: Vec::new(),
        aliases: vec![('O', '0'), ('I', '1'), ('L', '1')],
        permutation: Permutation::Disabled,
        profanity: None,
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
    assert_eq!(h.profile().min_length, 4);
    assert_eq!(h.profile().separator_min_length, 6);
    // The generation table of spec 17.1 pins the derived alphabets: 34 body
    // symbols (34^(L-2) per generation) and modulus 35^2 = 1225.
    let expected: [(usize, u64, u64); 5] = [
        (4, 0, 1156),
        (5, 1156, 39304),
        (6, 40460, 1336336),
        (7, 1376796, 45435424),
        (8, 46812220, 1544804416),
    ];
    for (l, base, cap) in expected {
        assert_eq!(h.generation_base(l), big(base), "generation base {l}");
        assert_eq!(h.generation_capacity(l), big(cap), "generation capacity {l}");
    }
}

#[test]
#[should_panic(expected = "capacity() is only defined for fixed-mode profiles")]
fn capacity_is_fixed_mode_only() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    h.capacity();
}

#[test]
fn boundary_round_trips() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    for l in 4..=8usize {
        let base = h.generation_base(l);
        let next = h.generation_base(l + 1);
        for id in [base.clone(), &next - 1u64, next.clone()] {
            let code = h.encode(&id).expect("boundary id issuable");
            assert_eq!(raw(&code).len(), h.generation_for_id(&id), "length of {id}");
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
    assert_eq!(raw(&h.encode(&big(1155)).unwrap()).len(), 4);
    assert_eq!(raw(&h.encode(&big(1156)).unwrap()).len(), 5);
}

#[test]
fn exhaustive_generation_four_round_trip() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    let mut issued = 0u32;
    for id in 0..1156u64 {
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
    assert!(issued > 1100, "expected nearly all 1156 ids issuable, got {issued}");
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
        let Ok(code) = h.encode(&big(id)) else { continue };
        if raw(&code)[raw(&code).len() - 2..].contains('0') {
            found.push((big(id), code));
        }
    }
    assert!(found.len() >= 8, "expected checksum-with-zero codes in the sample");
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
        let Ok(code) = h.encode(&big(id)) else { continue };
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
    // M = 1225 > 33 and gcd(36, 1225) = 1, so detection is provably total
    // (spec 17.1); the sweep pins it at generations 4, 6 and 8.
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    let alphabet: Vec<char> = EXPANDABLE_BODY.chars().collect();
    for l in [4usize, 6, 8] {
        let base = h.generation_base(l);
        let body_len = l - h.profile().checksum_length;
        let mut misses = 0u32;
        for offset in 0..50u64 {
            let Ok(code) = h.encode(&(&base + big(offset))) else { continue };
            let r: Vec<char> = raw(&code).chars().collect();
            for pos in 0..body_len {
                let cur = alphabet.iter().position(|c| *c == r[pos]).unwrap();
                for delta in [1usize, 5, 17] {
                    let mut candidate = r.clone();
                    candidate[pos] = alphabet[(cur + delta) % 34];
                    let candidate: String = candidate.into_iter().collect();
                    if h.decode(&candidate, &strict()).is_ok() {
                        misses += 1;
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
                    misses += 1;
                }
            }
        }
        assert_eq!(misses, 0, "generation {l} had {misses} checksum misses");
    }
}

#[test]
fn no_left_padding() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    expect_error(h.decode("1", &strict()), ErrorCode::InvalidLength);
    expect_error(h.decode("ABC", &strict()), ErrorCode::InvalidLength);
    expect_error(h.decode("", &strict()), ErrorCode::InvalidLength);
    expect_error(h.decode(&"A".repeat(33), &strict()), ErrorCode::InvalidLength);
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
    expect_error(h.decode(&with_hyphen, &strict()), ErrorCode::InvalidCharacter);
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
            expandable_grouping(l, &[4, 4]),
            "generation {l}: {code}"
        );
        assert_eq!(h.decode(&code, &strict()).unwrap().canonical_code, code);
    }
}

#[test]
fn expandable_grouping_is_right_anchored() {
    assert_eq!(expandable_grouping(6, &[4, 4]), vec![2, 4]);
    assert_eq!(expandable_grouping(7, &[4, 4]), vec![3, 4]);
    assert_eq!(expandable_grouping(8, &[4, 4]), vec![4, 4]);
    assert_eq!(expandable_grouping(9, &[4, 4]), vec![1, 4, 4]);
    assert_eq!(expandable_grouping(10, &[4, 4]), vec![2, 4, 4]);
    assert_eq!(expandable_grouping(12, &[4, 4]), vec![4, 4, 4]);
    assert_eq!(expandable_grouping(7, &[2, 3]), vec![2, 2, 3]);
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
    let code = raw(&h.encode(&big(40460)).unwrap()); // generation 6
    assert!(!h.validate(&code[1..], &strict()).valid);
}

#[test]
fn correction_stays_within_the_presented_generation() {
    let h = Baseh::new(baseh_expandable_v1()).unwrap();
    let id = big(123456789u64); // generation 8
    let code = h.encode(&id).unwrap();
    let r: Vec<char> = raw(&code).chars().collect();
    let pairs = [
        ('B', 'D'), ('D', 'B'), ('P', 'T'), ('T', 'P'),
        ('M', 'N'), ('N', 'M'), ('V', 'W'), ('W', 'V'),
    ];
    let mut typo: Option<String> = None;
    for (pos, ch) in r.iter().enumerate().take(r.len() - 2) {
        if let Some((_, replacement)) = pairs.iter().find(|(source, _)| source == ch) {
            let mut t = r.clone();
            t[pos] = *replacement;
            typo = Some(t.into_iter().collect());
            break;
        }
    }
    let typo = typo.expect("expected a confusable body symbol in the sample code");
    let options = DecodeOptions {
        try_correction: true,
        confusion_profile: ConfusionProfile::Medium,
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
    for id in [big(0), big(1), big(1155), big(1156), big(40460), big(123456789), gen9] {
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
    assert_ne!(frozen.encode(&big(42)).unwrap(), keyed.encode(&big(42)).unwrap());
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
    // [4, 4] does not sum to every expandable length and must validate.
    Baseh::new(baseh_expandable_v1()).expect("expandable tier valid");
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
            min_length: 1,
            ..custom_expandable()
        }),
        ErrorCode::InvalidProfile,
    );
}
