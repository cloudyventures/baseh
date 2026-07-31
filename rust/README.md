# base-human

Rust implementation of the HRC (Human Reference Code) codec: fixed-length,
checksummed, optionally permuted human-readable identifiers for internal
integer IDs. The normative specification is `../spec/IMPLEMENTATION_CODEC.md`
and cross-language conformance vectors live in `../vectors/`.

## Usage

```rust
use base_human::{hrc32_v1, hrc32s_v1, ConfusionProfile, DecodeOptions, Hrc};
use num_bigint::BigUint;

// Applications assign their own key material and key id. Keep both immutable
// for the life of the profile and out of frontend code.
let hrc = Hrc::new(hrc32_v1(b"application-key-material", "app-key-1"))?;

let code = hrc.encode(&BigUint::from(48_284_291u64))?; // e.g. "VCS-PQ2-G"
let result = hrc.decode(&code, &DecodeOptions::default())?;
assert_eq!(result.id, BigUint::from(48_284_291u64));
assert!(!result.corrected);

// Validation without a returned id (for customer-facing checks).
let outcome = hrc.validate("vcs pq2 g", &DecodeOptions {
    accept_spaces: true,
    ..DecodeOptions::default()
});

// Spoken-confusion correction after a checksum failure.
let fixed = hrc.decode("0000TBM", &DecodeOptions {
    try_correction: true,
    confusion_profile: ConfusionProfile::Light,
    ..DecodeOptions::default()
});
# Ok::<(), base_human::HrcError>(())
```

`hrc32s_v1` (two checksum symbols) is the right pick for unattended
self-service lookup: it provably detects all single-symbol substitutions and
adjacent transpositions (spec 6.3). `hrc32_v1` suits assisted support where a
human can ask for the code again.

## API summary

- `Hrc::new(profile)` validates the profile once (spec 2.2) at startup.
- `encode(&BigUint) -> Result<String, HrcError>`.
- `decode(&str, &DecodeOptions) -> Result<DecodeResult, HrcError>` returning
  the id, the canonical code and a `corrected` flag.
- `capacity() -> &BigUint` (arbitrary precision, may exceed u64).
- `validate(input, options) -> ValidateOutcome` never fails on user input and
  never exposes an internal id on failure.
- `hrc32_v1` / `hrc32s_v1` build the frozen profiles (8 Feistel rounds).
- `feistel::permute` / `feistel::inverse_permute` are public for conformance
  testing against `../vectors/feistel-vectors.json`.

## Errors

Every fallible call returns `HrcError { code, message, safe_for_customer }`.
`code.to_string()` renders the serialized spec form (`INVALID_CHECKSUM` and
so on). `safe_for_customer` marks messages that may be shown to end users
unchanged.

## Testing

`cargo test` runs:

- `tests/vectors.rs`: every frozen encode, decode, error, correction and
  Feistel vector from `../vectors/`, with profiles rebuilt from the embedded
  definitions.
- `tests/codec.rs`: profile-validation rejections, boundary round trips,
  normalization, aliases, correction, a 10k sequential-id round-trip smoke
  and a fixed-seed fuzz smoke.

Also gated on `cargo clippy --all-targets` (clean) and `cargo fmt --check`.

## License

MIT
