//! Repetition filter tests (spec section 21).

use baseh::{
    baseh_expandable_p_v1, baseh_expandable_v1, baseh_heavy_p_v1, baseh_heavy_v1, baseh_light_p_v1,
    baseh_light_v1, baseh_medium_p_v1, baseh_medium_v1, baseh_minimum_p_v1, baseh_minimum_v1,
    Baseh, ConfusionProfile, DecodeOptions, ErrorCode, Mode, Permutation, Profile,
};
use num_bigint::BigUint;

const KEY: &[u8] = b"test-only-key-material-0001";

fn alpha32() -> Profile {
    Profile {
        profile_id: "rep-test".to_string(),
        mode: Mode::Fixed,
        body_alphabet: "0123456789ABCDEFGHJKMNPQRSTVWXYZ".to_string(),
        body_length: 6,
        min_length: None,
        checksum_alphabet: "234679ACDEFGHJKMNPQRTUVWXY".to_string(),
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

fn max_run(raw: &str) -> usize {
    let chars: Vec<char> = raw.chars().collect();
    let mut best = 1;
    let mut run = 1;
    for pair in chars.windows(2) {
        run = if pair[0] == pair[1] { run + 1 } else { 1 };
        best = best.max(run);
    }
    best
}

/// First id whose raw code (per a filter-free twin) has max run exactly n.
fn find_id_with_run(profile: &Profile, n: usize) -> BigUint {
    let mut twin_profile = profile.clone();
    twin_profile.max_repetition = 0;
    twin_profile.profanity = None;
    let twin = Baseh::new(twin_profile).unwrap();
    for id in 0u64..5_000_000 {
        let id = BigUint::from(id);
        let code = twin.encode(&id).unwrap();
        let raw: String = code.chars().filter(|c| *c != '-').collect();
        if max_run(&raw) == n {
            return id;
        }
    }
    panic!("no id with max run {n} below 5,000,000");
}

fn assert_blocked(result: Result<String, baseh::BasehError>, case: &str) {
    let err = match result {
        Ok(code) => panic!("{case} must be blocked, got {code}"),
        Err(err) => err,
    };
    assert_eq!(err.code, ErrorCode::BlockedCode, "{case}");
}

#[test]
fn validation_rejects_1_and_2_accepts_0_and_3() {
    for bad in [1usize, 2] {
        let mut profile = alpha32();
        profile.max_repetition = bad;
        let err = match Baseh::new(profile) {
            Ok(_) => panic!("{bad} must be rejected"),
            Err(err) => err,
        };
        assert_eq!(err.code, ErrorCode::InvalidProfile);
    }
    for ok in [0usize, 3, 99] {
        // A value above the code length is a legal no-op.
        let mut profile = alpha32();
        profile.max_repetition = ok;
        Baseh::new(profile).unwrap_or_else(|e| panic!("{ok} must be accepted: {e}"));
    }
    assert_eq!(alpha32().max_repetition, 0, "defaults to off");
}

#[test]
fn encode_blocks_run_of_exactly_4() {
    let mut profile = alpha32();
    profile.max_repetition = 4;
    assert_blocked(
        Baseh::new(profile.clone())
            .unwrap()
            .encode(&find_id_with_run(&profile, 4)),
        "run of 4",
    );
}

#[test]
fn encode_allows_run_of_exactly_3() {
    let mut profile = alpha32();
    profile.max_repetition = 4;
    let h = Baseh::new(profile.clone()).unwrap();
    let id = find_id_with_run(&profile, 3);
    let code = h.encode(&id).expect("run of 3 passes");
    assert_eq!(h.decode(&code, &DecodeOptions::default()).unwrap().id, id);
}

#[test]
fn filter_is_off_at_0() {
    let mut profile = alpha32();
    profile.max_repetition = 4;
    let id = find_id_with_run(&profile, 4);
    let off = Baseh::new(alpha32()).unwrap();
    let code = off.encode(&id).expect("off at 0");
    assert_eq!(off.decode(&code, &DecodeOptions::default()).unwrap().id, id);
}

#[test]
fn custom_max_repetition_3_blocks_triples() {
    let mut profile = alpha32();
    profile.max_repetition = 3;
    assert_blocked(
        Baseh::new(profile.clone())
            .unwrap()
            .encode(&find_id_with_run(&profile, 3)),
        "run of 3 under max 3",
    );
}

#[test]
fn separators_do_not_break_a_run() {
    // Body "AAAA" renders AA-AA...: no formatted group shows a run of 4, but
    // the raw code is AAAA + checksum, a run of 4, so the filter fires.
    let profile = Profile {
        profile_id: "rep-sep-test".to_string(),
        mode: Mode::Fixed,
        body_alphabet: "0123456789ABCDEF".to_string(),
        body_length: 4,
        min_length: None,
        checksum_alphabet: "234679ACDEFGHJKMNPQRTUVWXY".to_string(),
        checksum_length: 1,
        short_checksum_length: 0,
        short_checksum_until: 0,
        case_sensitive: false,
        separator: "-".to_string(),
        separator_min_length: 0,
        grouping: vec![2, 2, 1],
        aliases: Vec::new(),
        permutation: Permutation::Disabled,
        profanity: None,
        max_repetition: 4,
    };
    let id = BigUint::from(10u64 * 16u64.pow(3) + 10 * 16u64.pow(2) + 10 * 16 + 10); // body AAAA
    let mut twin_profile = profile.clone();
    twin_profile.max_repetition = 0;
    let twin = Baseh::new(twin_profile).unwrap();
    assert!(twin.encode(&id).unwrap().starts_with("AA-AA"));
    assert_blocked(
        Baseh::new(profile).unwrap().encode(&id),
        "separator-straddling run",
    );
}

#[test]
fn issuance_skips_a_blocked_id_by_advancing() {
    let mut profile = alpha32();
    profile.max_repetition = 4;
    let h = Baseh::new(profile.clone()).unwrap();
    let mut id = find_id_with_run(&profile, 4);
    let code = loop {
        match h.encode(&id) {
            Ok(code) => break code,
            Err(err) => {
                assert_eq!(err.code, ErrorCode::BlockedCode);
                id += 1u64;
            }
        }
    };
    assert_eq!(h.decode(&code, &DecodeOptions::default()).unwrap().id, id);
}

#[test]
fn decode_reports_blocked_code_for_unissuable_code() {
    let mut profile = alpha32();
    profile.max_repetition = 4;
    let h = Baseh::new(profile.clone()).unwrap();
    let twin = Baseh::new(alpha32()).unwrap();
    let code = twin.encode(&find_id_with_run(&profile, 4)).unwrap();
    let err = h
        .decode(&code, &DecodeOptions::default())
        .expect_err("blocked decode");
    assert_eq!(err.code, ErrorCode::BlockedCode);
}

#[test]
fn correction_never_corrects_into_a_blocked_code() {
    // "00BBBB" is one light-confusion flip (D->B) from the presented body
    // "00DBBB"; the sole checksum-matching candidate carries a run of 4, so
    // decode surfaces BLOCKED_CODE instead of returning the corrected code.
    let mut profile = alpha32();
    profile.max_repetition = 4;
    let h = Baseh::new(profile).unwrap();
    let twin = Baseh::new(alpha32()).unwrap();
    // id whose body is "00BBBB": B is symbol 11 in the 32-symbol alphabet.
    let id = BigUint::from(11u64 * 32u64.pow(3) + 11 * 32u64.pow(2) + 11 * 32 + 11);
    let code = twin.encode(&id).unwrap();
    assert!(
        code.starts_with("00BBBB"),
        "twin code is 00BBBB + checksum: {code}"
    );
    let presented = format!("00DBBB{}", &code[6..]);
    let options = DecodeOptions {
        try_correction: true,
        confusion_profile: ConfusionProfile::Light,
        max_corrections: 1,
        ..DecodeOptions::default()
    };
    let err = h
        .decode(&presented, &options)
        .expect_err("blocked correction");
    assert_eq!(err.code, ErrorCode::BlockedCode);
}

#[test]
fn every_frozen_tier_blocks_a_doctored_4_run_id() {
    let tiers: Vec<(&str, Profile)> = vec![
        ("baseh-minimum-v1", baseh_minimum_v1()),
        ("baseh-light-v1", baseh_light_v1()),
        ("baseh-medium-v1", baseh_medium_v1()),
        ("baseh-heavy-v1", baseh_heavy_v1()),
        ("baseh-minimum-p-v1", baseh_minimum_p_v1(KEY, "", 0)),
        ("baseh-light-p-v1", baseh_light_p_v1(KEY, "", 0)),
        ("baseh-medium-p-v1", baseh_medium_p_v1(KEY, "", 0)),
        ("baseh-heavy-p-v1", baseh_heavy_p_v1(KEY, "", 0)),
        ("baseh-expandable-v1", baseh_expandable_v1()),
        ("baseh-expandable-p-v1", baseh_expandable_p_v1(KEY, "", 0)),
    ];
    for (name, profile) in tiers {
        assert_eq!(profile.max_repetition, 4, "{name} ships maxRepetition 4");
        let h = Baseh::new(profile.clone()).unwrap();
        assert_blocked(h.encode(&find_id_with_run(&profile, 4)), name);
    }
}
