//! Cross-language conformance vectors from ../../vectors/.
//!
//! The files are frozen; a release fails if any implementation disagrees.

use std::collections::HashMap;

use base_human::{
    feistel, ConfusionProfile, DecodeOptions, ErrorCode, Hrc, Permutation, Profile,
};
use num_bigint::BigUint;
use serde_json::Value;

fn vectors_path(name: &str) -> String {
    format!("{}/../vectors/{}", env!("CARGO_MANIFEST_DIR"), name)
}

fn load(name: &str) -> Value {
    let text = std::fs::read_to_string(vectors_path(name)).expect("vector file readable");
    serde_json::from_str(&text).expect("vector file is valid JSON")
}

fn big(value: &Value) -> BigUint {
    value
        .as_str()
        .expect("decimal string")
        .parse::<BigUint>()
        .expect("valid decimal")
}

fn profile_from_definition(def: &Value) -> Profile {
    let aliases = def["aliases"]
        .as_object()
        .expect("aliases object")
        .iter()
        .map(|(k, v)| {
            (
                k.chars().next().expect("alias source"),
                v.as_str().expect("alias target").chars().next().expect("alias target char"),
            )
        })
        .collect();
    let perm = &def["permutation"];
    let permutation = if perm["enabled"].as_bool().expect("enabled bool") {
        Permutation::FeistelV1 {
            key_id: perm["keyId"].as_str().expect("keyId").to_string(),
            key_bytes: hex::decode(perm["keyBytesHex"].as_str().expect("keyBytesHex"))
                .expect("valid hex key"),
            rounds: perm["rounds"].as_u64().expect("rounds") as u32,
        }
    } else {
        Permutation::Disabled
    };
    Profile {
        profile_id: def["profileId"].as_str().unwrap().to_string(),
        body_alphabet: def["bodyAlphabet"].as_str().unwrap().to_string(),
        body_length: def["bodyLength"].as_u64().unwrap() as usize,
        checksum_alphabet: def["checksumAlphabet"].as_str().unwrap().to_string(),
        checksum_length: def["checksumLength"].as_u64().unwrap() as usize,
        case_sensitive: def["caseSensitive"].as_bool().unwrap(),
        separator: def["separator"].as_str().unwrap().to_string(),
        grouping: def["grouping"]
            .as_array()
            .unwrap()
            .iter()
            .map(|g| g.as_u64().unwrap() as usize)
            .collect(),
        aliases,
        permutation,
    }
}

struct Fixture {
    profiles: HashMap<String, Hrc>,
    root: Value,
}

impl Fixture {
    fn load() -> Self {
        let root = load("vectors.json");
        let profiles = root["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                let id = p["profileId"].as_str().unwrap().to_string();
                let hrc = Hrc::new(profile_from_definition(&p["definition"]))
                    .expect("vector profiles are valid");
                (id, hrc)
            })
            .collect();
        Fixture { profiles, root }
    }

    fn get(&self, profile_id: &str) -> &Hrc {
        self.profiles
            .get(profile_id)
            .unwrap_or_else(|| panic!("unknown profile {profile_id}"))
    }
}

#[test]
fn profile_capacities_match() {
    let fixture = Fixture::load();
    for p in fixture.root["profiles"].as_array().unwrap() {
        let hrc = fixture.get(p["profileId"].as_str().unwrap());
        assert_eq!(
            hrc.capacity(),
            &big(&p["capacity"]),
            "capacity for {}",
            p["profileId"]
        );
    }
}

#[test]
fn encode_vectors() {
    let fixture = Fixture::load();
    for v in fixture.root["vectors"].as_array().unwrap() {
        let hrc = fixture.get(v["profileId"].as_str().unwrap());
        let id = big(&v["id"]);
        let code = hrc.encode(&id).unwrap_or_else(|e| {
            panic!("encode {} for {} failed: {}", v["id"], v["profileId"], e)
        });
        assert_eq!(
            code,
            v["canonicalCode"].as_str().unwrap(),
            "encode {} ({})",
            v["id"],
            v["profileId"]
        );
    }
}

#[test]
fn decode_vectors() {
    let fixture = Fixture::load();
    let options = DecodeOptions::default();
    for v in fixture.root["vectors"].as_array().unwrap() {
        let hrc = fixture.get(v["profileId"].as_str().unwrap());
        let input = v["input"].as_str().unwrap_or_else(|| v["canonicalCode"].as_str().unwrap());
        let result = hrc.decode(input, &options).unwrap_or_else(|e| {
            panic!("decode {input:?} for {} failed: {e}", v["profileId"])
        });
        assert_eq!(
            result.id,
            big(&v["id"]),
            "decode id {input:?} ({})",
            v["profileId"]
        );
        assert_eq!(
            result.canonical_code,
            v["canonicalCode"].as_str().unwrap(),
            "decode canonical {input:?} ({})",
            v["profileId"]
        );
        // Canonical inputs report corrected=false; the aliased, spaced and
        // lowercase vector inputs are checked explicitly in tests/codec.rs.
        if v.get("input").is_none() {
            assert!(!result.corrected, "canonical input corrected ({})", v["profileId"]);
        }
    }
}

#[test]
fn formatted_code_carries_expected_raw_parts() {
    let fixture = Fixture::load();
    for v in fixture.root["vectors"].as_array().unwrap() {
        let hrc = fixture.get(v["profileId"].as_str().unwrap());
        let code = hrc.encode(&big(&v["id"])).unwrap();
        let raw: String = code
            .chars()
            .filter(|c| *c != hrc.profile().separator.chars().next().unwrap())
            .collect();
        let body_len = hrc.profile().body_length;
        if let Some(expected_body) = v.get("rawBody") {
            assert_eq!(raw[..body_len], expected_body.as_str().unwrap());
        }
        if let Some(expected_checksum) = v.get("rawChecksum") {
            assert_eq!(raw[body_len..], expected_checksum.as_str().unwrap());
        }
    }
}

#[test]
fn error_vectors() {
    let fixture = Fixture::load();
    let options = DecodeOptions::default();
    for v in fixture.root["errors"].as_array().unwrap() {
        let hrc = fixture.get(v["profileId"].as_str().unwrap());
        let input = v["input"].as_str().unwrap();
        let expected: ErrorCode = v["error"].as_str().unwrap().parse().expect("known error code");
        let err = hrc
            .decode(input, &options)
            .expect_err(&format!("decode {input:?} must fail with {expected}"));
        assert_eq!(err.code, expected, "decode {input:?}");
        // Per spec 13 the failure must not leak a candidate internal ID; the
        // error type carries no id by construction.
        let outcome = hrc.validate(input, &options);
        assert!(!outcome.valid);
        assert_eq!(outcome.reason, Some(expected));
        assert!(outcome.canonical_code.is_none());
    }
}

#[test]
fn correction_vectors() {
    let fixture = Fixture::load();
    let options = DecodeOptions {
        accept_spaces: false,
        try_correction: true,
        confusion_profile: ConfusionProfile::Light,
        max_corrections: 1,
    };
    for v in fixture.root["correction"].as_array().unwrap() {
        let hrc = fixture.get(v["profileId"].as_str().unwrap());
        let input = v["input"].as_str().unwrap();
        let body_len = hrc.profile().body_length;
        if let Some(expected_body) = v.get("expectedBody") {
            let result = hrc
                .decode(input, &options)
                .expect(&format!("correction of {input:?} must succeed"));
            let raw: String = result
                .canonical_code
                .chars()
                .filter(|c| !hrc.profile().separator.contains(*c))
                .collect();
            assert_eq!(raw[..body_len], expected_body.as_str().unwrap());
            assert!(result.corrected, "correction of {input:?} flags corrected");
        } else {
            let expected: ErrorCode = v["error"].as_str().unwrap().parse().unwrap();
            let err = hrc
                .decode(input, &options)
                .expect_err(&format!("correction of {input:?} must fail with {expected}"));
            assert_eq!(err.code, expected);
        }
    }
}

#[test]
fn feistel_vectors() {
    let root = load("feistel-vectors.json");
    for v in root["vectors"].as_array().unwrap() {
        let profile_id = v["profileId"].as_str().unwrap();
        let key_bytes = hex::decode(v["keyBytesHex"].as_str().unwrap()).unwrap();
        let capacity = big(&v["capacity"]);
        let rounds = v["rounds"].as_u64().unwrap() as u32;
        let input = big(&v["input"]);
        let permuted = big(&v["permuted"]);
        let got = feistel::permute(&input, &capacity, profile_id, &key_bytes, rounds)
            .expect(&format!("permute {} within {}", v["input"], v["capacity"]));
        assert_eq!(
            got, permuted,
            "permute {} (capacity {} rounds {})",
            v["input"], v["capacity"], v["rounds"]
        );
        let back = feistel::inverse_permute(&permuted, &capacity, profile_id, &key_bytes, rounds)
            .expect("inverse must succeed");
        assert_eq!(back, input, "inverse(permute(x)) == x for {}", v["input"]);
    }
}
