# baseh

Rust implementation of the baseH codec: checksummed, optionally permuted
human-readable identifiers for internal integer IDs. Codes are expandable by
default — they start short and grow as the id sequence climbs — with
fixed-length tiers available for constant-width needs. The normative
specification is `../spec/IMPLEMENTATION_CODEC.md` and cross-language
conformance vectors live in `../vectors/`.

## Usage

Expandable mode (shipping in the next release) is the recommended default for
new users: codes start at 4 characters and grow one character at a time as
ids climb past each length's capacity — transparently, with no migration and
no re-issue. Old shorter codes keep decoding forever.

```rust
use baseh::{baseh_expandable_v1, Baseh, DecodeOptions};
use num_bigint::BigUint;

let baseh = Baseh::new(baseh_expandable_v1())?;

let code = baseh.encode(&BigUint::from(48_284_291u64))?;
// a few characters long at this namespace size; grows as ids climb.
let result = baseh.decode(&code, &DecodeOptions::default())?;
assert_eq!(result.id, BigUint::from(48_284_291u64));
# Ok::<(), baseh::BasehError>(())
```

The expandable body alphabet never contains `0` or `O` (34 symbols by
default; any `0`/`O` in a custom alphabet are silently removed during profile
preparation). The checksum alphabet adds `0` back (35 symbols), and the
existing `O -> 0` input alias still repairs a misread checksum character.
There is no left-padding, the Feistel permutation stays on (applied per code
length, so codes within each length look random even though issuance is
sequential), and separators only appear once codes reach
`separator_min_length` (6 in the shipped tier). All existing profile options
— visual/spoken safety levels, profanity modes, blocklists — compose with
expandable unchanged. For private scrambling use `baseh_expandable_p_v1`
with your own key material, exactly like the fixed `*_p_v1` tiers below.

For validation, spoken-typo correction and the rest of the codec surface see
the fixed-mode example below and the API summary; they work identically in
expandable mode. Security posture is unchanged: a code is a reference alias,
never an authorization token — expandable codes in the smallest generations
are a small namespace, so rate-limit public lookups and enforce authorization
after decode.

## Fixed mode

Fixed mode keeps codes at one constant width, left-padding as today, for
layouts that need a stable shape. Medium is the default fixed tier.

```rust
use baseh::{baseh_medium_v1, Baseh, ConfusionProfile, DecodeOptions};
use num_bigint::BigUint;

// Medium is the default tier; it permutes with the frozen public key and
// needs no key material.
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

// Spoken-confusion correction after a checksum failure: here a G misheard
// as a C is repaired and the amended canonical code is returned.
let fixed = baseh.decode("MGV3-JKDJ", &DecodeOptions {
    try_correction: true,
    confusion_profile: ConfusionProfile::Heavy,
    max_corrections: 1,
    ..DecodeOptions::default()
});
assert_eq!(fixed?.canonical_code, "MCV3-JKDJ");
# Ok::<(), baseh::BasehError>(())
```

## Frozen tiers

All frozen tiers below are `mode: "fixed"` and behave exactly as they always
have. Four frozen tiers trade alphabet safety for capacity. All are 6 body
symbols, case-insensitive, hyphen-delimited at the midpoint, run the default
profanity blocklist and keep the typed O/I/L aliases where possible. Medium
is the default fixed tier.

| Tier                | Symbols | Checksums | Shape     | Capacity      |
| ------------------- | ------- | --------- | --------- | ------------- |
| `baseh_minimum_v1`  | 36      | 0         | XXX-XXX   | 2,176,782,336 |
| `baseh_light_v1`    | 31      | 2         | XXXX-XXXX | 887,503,681   |
| `baseh_medium_v1`   | 28      | 2         | XXXX-XXXX | 481,890,304   |
| `baseh_heavy_v1`    | 26      | 2         | XXXX-XXXX | 308,915,776   |

Every helper returns a freshly-built profile value, so callers can load a
default and modify it before constructing the codec.

## Permutation (always on, frozen key)

Every plain tier permutes with feistel-v1 under the frozen published key
`FROZEN_KEY_BYTES` (key id "frozen", 8 rounds). The key is public by design:
it makes issued codes look non-sequential but offers no secrecy, since anyone
can read it here. Never swap it on a live namespace; codes only decode with
the key they were issued under.

For private scrambling use the `*_p_v1` variants and supply your own key
material, key id and round count (pass an empty key id or 0 rounds for the
defaults "default" and 8). Keep both immutable for the life of the profile
and out of frontend code.

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
- `capacity() -> Result<&BigUint, BasehError>` (arbitrary precision, may
  exceed u64). Fixed mode only; expandable profiles fail `INVALID_PROFILE`.
- `validate(input, options) -> ValidateOutcome` never fails on user input
  and never exposes an internal id on failure.
- `inspect(input) -> InspectResult` (spec 12.5) gives live as-you-type
  feedback: an enum with per-state variants (`Empty`, `Typing { typed,
  progress }`, `BadChar`, `TooLong`, `Invalid { reason }`, `Valid { id,
  canonical_code }`); `InspectResult::state()` renders the cross-language
  state name. It never panics on user input and never reports `Valid` for an
  incomplete code. `baseh::inspect` applies it to the default profile.
- `baseh_expandable_v1` builds the recommended expandable tier profile
  (`mode: "expandable"`, `min_length` 4, `separator_min_length` 6), permuting
  per code length with the public frozen key; `baseh_expandable_p_v1` takes
  caller-supplied key material instead. `min_length` is an `Option<usize>`:
  `None` selects the default of 4 and an explicit `Some(0)` is rejected.
- `baseh_minimum_v1` / `baseh_light_v1` / `baseh_medium_v1` /
  `baseh_heavy_v1` build the frozen fixed-mode tier profiles, each permuting
  with the public frozen key. The `*_p_v1` variants permute with
  caller-supplied key material instead.
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
  correction, inspect and Feistel vector from `../vectors/`, with profiles
  (including profanity modes) rebuilt from the embedded definitions.
- `tests/inspect.rs`: the spec 12.5 state machine in both modes — every
  state, partial-prefix rendering, aliases while typing and the spec 3.4
  padded-prefix false-green case.
- `tests/codec.rs`: profile-validation rejections, boundary round trips,
  normalization, aliases, correction, blocklist and no-vowels behavior, a
  10k sequential-id round-trip smoke and a fixed-seed fuzz smoke.

Also gated on `cargo clippy --all-targets` (clean) and `cargo fmt --check`.

## License

AGPL-3.0-only
