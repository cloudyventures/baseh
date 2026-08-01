# baseh

Rust implementation of the baseH codec: fixed-length,
checksummed, optionally permuted human-readable identifiers for internal
integer IDs. The normative specification is `../spec/IMPLEMENTATION_CODEC.md`
and cross-language conformance vectors live in `../vectors/`.

## Usage

```rust
use baseh::{baseh_medium_v1, Baseh, ConfusionProfile, DecodeOptions};
use num_bigint::BigUint;

// Medium is the default tier; permutation is off and needs no key material.
let baseh = Baseh::new(baseh_medium_v1())?;

let code = baseh.encode(&BigUint::from(48_284_291u64))?;
let result = baseh.decode(&code, &DecodeOptions::default())?;
assert_eq!(result.id, BigUint::from(48_284_291u64));
assert!(!result.corrected);

// Validation without a returned id (for customer-facing checks).
let outcome = baseh.validate("vcs pq2 g", &DecodeOptions {
    accept_spaces: true,
    ..DecodeOptions::default()
});

// Spoken-confusion correction after a checksum failure.
let fixed = baseh.decode("0000TBC", &DecodeOptions {
    try_correction: true,
    confusion_profile: ConfusionProfile::Light,
    ..DecodeOptions::default()
});
# Ok::<(), baseh::BasehError>(())
```

## Frozen tiers

Four frozen tiers trade alphabet safety for capacity. All are 6 body symbols,
case-insensitive, run the default profanity blocklist and keep the typed
O/I/L aliases where possible. Medium is the default.

| Tier                | Symbols | Checksum | Capacity      |
| ------------------- | ------- | -------- | ------------- |
| `baseh_minimum_v1`  | 36      | 0        | 2,176,782,336 |
| `baseh_light_v1`    | 31      | 1        | 887,503,681   |
| `baseh_medium_v1`   | 28      | 1        | 481,890,304   |
| `baseh_heavy_v1`    | 26      | 1        | 308,915,776   |

Minimum is hyphen-delimited XXX-XXX; the rest have no separator. Every helper
returns a freshly-built profile value, so callers can load a default and
modify it before constructing the codec.

## Permutation (opt-in)

The plain tier helpers ship with the permutation disabled. To enable
feistel-v1 use the `*_p_v1` variants and supply your own key material, key id
and round count (pass an empty key id or 0 rounds for the defaults
"default" and 8). Keep both immutable for the life of the profile and out of
frontend code.

```rust
use baseh::{baseh_medium_p_v1, Baseh};
# fn f() -> Result<(), baseh::BasehError> {
let baseh = Baseh::new(baseh_medium_p_v1(b"application-key-material", "app-key-1", 8))?;
# Ok(())
# }
```

## Profanity safety (spec 18)

Profiles accept an optional `profanity` object with three modes:

- `None` (default): no filtering.
- `NoVowels`: strips `A E I O U` from both alphabets before any other
  profile-derived computation. Capacity, checksums and every downstream rule
  then run on the stripped alphabets.
- `Blocklist`: the encoder refuses (new error `BLOCKED_CODE`) any code whose
  raw string contains a blocked substring. `words` replaces the small
  built-in default list and `extra_words` appends to it. Decode may also
  raise `BLOCKED_CODE`, since a blocked code could never have been issued.

## API summary

- `Baseh::new(profile)` validates the profile once (specs 2.2 and 18).
- `encode(&BigUint) -> Result<String, BasehError>`.
- `decode(&str, &DecodeOptions) -> Result<DecodeResult, BasehError>`
  returning the id, the canonical code and a `corrected` flag.
- `capacity() -> &BigUint` (arbitrary precision, may exceed u64).
- `validate(input, options) -> ValidateOutcome` never fails on user input
  and never exposes an internal id on failure.
- `baseh_minimum_v1` / `baseh_light_v1` / `baseh_medium_v1` /
  `baseh_heavy_v1` build the frozen tier profiles with the permutation
  disabled. The `*_p_v1` variants build them with feistel-v1 enabled and
  require caller-supplied key material.
- `feistel::permute` / `feistel::inverse_permute` are public for conformance
  testing against `../vectors/feistel-vectors.json`.

## Errors

Every fallible call returns `BasehError { code, message, safe_for_customer }`.
`code.to_string()` renders the serialized spec form (`INVALID_CHECKSUM` and
so on). `safe_for_customer` marks messages that may be shown to end users
unchanged; `BLOCKED_CODE` is never customer-safe since it is an issuance
decision. Applications should advance their sequence by one and re-encode.

## Testing

`cargo test` runs:

- `tests/vectors.rs`: every frozen encode, decode, error, encode-error,
  correction and Feistel vector from `../vectors/`, with profiles (including
  profanity modes) rebuilt from the embedded definitions.
- `tests/codec.rs`: profile-validation rejections, boundary round trips,
  normalization, aliases, correction, blocklist and no-vowels behavior, a
  10k sequential-id round-trip smoke and a fixed-seed fuzz smoke.

Also gated on `cargo clippy --all-targets` (clean) and `cargo fmt --check`.

## License

AGPL-3.0-only
