//! Cross-language conformance vectors from ../../vectors/.
//!
//! The files are frozen; a release fails if any implementation disagrees.

use std::collections::HashMap;

use baseh::{
    feistel, Baseh, ConfusionProfile, DecodeOptions, ErrorCode, Permutation, Profanity,
    ProfanityMode, Profile,
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

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .expect("string array")
        .iter()
        .map(|w| w.as_str().expect("word string").to_string())
        .collect()
}

fn profile_from_definition(def: &Value) -> Profile {
    let aliases = def["aliases"]
        .as_object()
        .expect("aliases object")
        .iter()
        .map(|(k, v)| {
            (
                k.chars().next().expect("alias source"),
                v.as_str()
                    .expect("alias target")
                    .chars()
                    .next()
                    .expect("alias target char"),
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
    let profanity = def.get("profanity").map(|p| {
        let mode = match p["mode"].as_str().expect("profanity mode") {
            "none" => ProfanityMode::None,
            "no-vowels" => ProfanityMode::NoVowels,
            "blocklist" => ProfanityMode::Blocklist,
            other => panic!("unknown profanity mode {other}"),
        };
        Profanity {
            mode,
            words: p.get("words").map(strings),
            extra_words: p.get("extraWords").map(strings).unwrap_or_default(),
        }
    });
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
        profanity,
    }
}

fn strip_separators(code: &str, profile: &Profile) -> String {
    code.chars()
        .filter(|c| !profile.separator.contains(*c))
        .collect()
}

struct Fixture {
    profiles: HashMap<String, Baseh>,
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
                let baseh = Baseh::new(profile_from_definition(&p["definition"]))
                    .expect("vector profiles are valid");
                (id, baseh)
            })
            .collect();
        Fixture { profiles, root }
    }

    fn get(&self, profile_id: &str) -> &Baseh {
        self.profiles
            .get(profile_id)
            .unwrap_or_else(|| panic!("unknown profile {profile_id}"))
    }
}

#[test]
fn profile_capacities_match() {
    let fixture = Fixture::load();
    for p in fixture.root["profiles"].as_array().unwrap() {
        let baseh = fixture.get(p["profileId"].as_str().unwrap());
        assert_eq!(
            baseh.capacity(),
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
        let baseh = fixture.get(v["profileId"].as_str().unwrap());
        let id = big(&v["id"]);
        let code = baseh
            .encode(&id)
            .unwrap_or_else(|e| panic!("encode {} for {} failed: {}", v["id"], v["profileId"], e));
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
        let baseh = fixture.get(v["profileId"].as_str().unwrap());
        let input = v["input"]
            .as_str()
            .unwrap_or_else(|| v["canonicalCode"].as_str().unwrap());
        let result = baseh
            .decode(input, &options)
            .unwrap_or_else(|e| panic!("decode {input:?} for {} failed: {e}", v["profileId"]));
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
        // Canonical inputs report corrected=false; aliased and lowercase
        // inputs are checked explicitly in tests/codec.rs.
        if v.get("input").is_none() {
            assert!(
                !result.corrected,
                "canonical input corrected ({})",
                v["profileId"]
            );
        }
    }
}

#[test]
fn formatted_code_carries_expected_raw_parts() {
    let fixture = Fixture::load();
    for v in fixture.root["vectors"].as_array().unwrap() {
        let baseh = fixture.get(v["profileId"].as_str().unwrap());
        let code = baseh.encode(&big(&v["id"])).unwrap();
        let raw = strip_separators(&code, baseh.profile());
        let body_len = baseh.profile().body_length;
        if let Some(expected_body) = v.get("rawBody") {
            assert_eq!(&raw[..body_len], expected_body.as_str().unwrap());
        }
        if let Some(expected_checksum) = v.get("rawChecksum") {
            assert_eq!(&raw[body_len..], expected_checksum.as_str().unwrap());
        }
    }
}

#[test]
fn error_vectors() {
    let fixture = Fixture::load();
    let options = DecodeOptions::default();
    for v in fixture.root["errors"].as_array().unwrap() {
        let baseh = fixture.get(v["profileId"].as_str().unwrap());
        let input = v["input"].as_str().unwrap();
        let expected: ErrorCode = v["error"]
            .as_str()
            .unwrap()
            .parse()
            .expect("known error code");
        let err = match baseh.decode(input, &options) {
            Ok(_) => panic!("decode {input:?} must fail with {expected}"),
            Err(err) => err,
        };
        assert_eq!(err.code, expected, "decode {input:?}");
        // Per spec 13 the failure must not leak a candidate internal ID; the
        // error type carries no id by construction.
        let outcome = baseh.validate(input, &options);
        assert!(!outcome.valid);
        assert_eq!(outcome.reason, Some(expected));
        assert!(outcome.canonical_code.is_none());
    }
}

#[test]
fn encode_error_vectors() {
    let fixture = Fixture::load();
    for v in fixture.root["encodeErrors"].as_array().unwrap() {
        let baseh = fixture.get(v["profileId"].as_str().unwrap());
        let expected: ErrorCode = v["error"].as_str().unwrap().parse().unwrap();
        let err = match baseh.encode(&big(&v["id"])) {
            Ok(code) => panic!(
                "encode {} ({}) must fail with {expected}, got {code}",
                v["id"], v["profileId"]
            ),
            Err(err) => err,
        };
        assert_eq!(
            err.code, expected,
            "encode {} ({})",
            v["id"], v["profileId"]
        );
        assert!(
            !err.safe_for_customer,
            "blocked codes are an issuance decision"
        );
    }
}

#[test]
fn correction_vectors() {
    let fixture = Fixture::load();
    for v in fixture.root["correction"].as_array().unwrap() {
        let baseh = fixture.get(v["profileId"].as_str().unwrap());
        let input = v["input"].as_str().unwrap();
        let confusion = match v["confusionProfile"].as_str().unwrap_or("light") {
            "none" => ConfusionProfile::None,
            "light" => ConfusionProfile::Light,
            "medium" => ConfusionProfile::Medium,
            "heavy" => ConfusionProfile::Heavy,
            other => panic!("unknown confusion profile {other}"),
        };
        let options = DecodeOptions {
            accept_spaces: false,
            try_correction: true,
            confusion_profile: confusion,
            max_corrections: 1,
        };
        if let Some(expected_body) = v.get("expectedBody") {
            let result = baseh
                .decode(input, &options)
                .unwrap_or_else(|e| panic!("correction of {input:?} must succeed: {e}"));
            let body_len = baseh.profile().body_length;
            let raw = strip_separators(&result.canonical_code, baseh.profile());
            assert_eq!(&raw[..body_len], expected_body.as_str().unwrap());
            assert!(result.corrected, "correction of {input:?} flags corrected");
        } else {
            let expected: ErrorCode = v["error"].as_str().unwrap().parse().unwrap();
            let err = match baseh.decode(input, &options) {
                Ok(_) => panic!("correction of {input:?} must fail with {expected}"),
                Err(err) => err,
            };
            assert_eq!(err.code, expected, "correction of {input:?}");
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
            .unwrap_or_else(|_| panic!("permute {} within {}", v["input"], v["capacity"]));
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
