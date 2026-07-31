# Human Reference Code

## Status

Implementation specification.

## Purpose

Human Reference Code, abbreviated HRC, converts non-negative integers into short alphanumeric references that people can read, type and dictate. It is intended for order numbers, support tickets, cases, returns, bookings and similar records.

The encoded value is reversible. A system can convert an internal numeric identifier into an HRC and convert a valid HRC back into the same identifier.

## Design goals

1. Short enough for routine customer use.
2. Case-insensitive by default.
3. Configurable visual safety.
4. Configurable spoken safety.
5. Deterministic integer-to-code conversion.
6. Optional non-sequential appearance.
7. Checksum-based error detection.
8. Limited ambiguity resolution when input may contain a known substitution.
9. No dependency on a central service.
10. Stable behaviour across implementations.

## Non-goals

- Encryption.
- Authentication.
- Authorization.
- Guaranteed correction of arbitrary errors.
- Globally unique identifiers without an external namespace.
- Protection against deliberate guessing.
- Replacement for an internal database key.

An HRC is a reference alias. Access control must not depend on its secrecy.

## Documents

| File | Purpose |
|---|---|
| `IMPLEMENTATION_CODEC.md` | Normative codec, checksum, aliases, API and algorithms |
| `IMPLEMENTATION_CAPACITY_CALCULATOR.md` | Interactive forward capacity calculator |
| `IMPLEMENTATION_CODE_DESIGNER.md` | Reverse designer driven by required capacity |
| `IMPLEMENTATION_TEST_SUITE.md` | Unit, property, compatibility, fuzz and performance testing |
| `PATENT_AND_PRIOR_ART_RESEARCH.md` | Prior art, patent-risk framing and implementation recommendations |
| `DESIGN_NOTES.md` | Decisions, alternatives and future extensions |

## Recommended default profile

The initial implementation should ship with this profile:

```yaml
profile_id: hrc32-v1
body_alphabet: "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
body_length: 6
checksum_alphabet: "234679ACDEFGHJKMNPQRTUVWXY"
checksum_length: 1
case_sensitive: false
grouping: [3, 3, 1]
separator: "-"
permutation:
  enabled: true
  algorithm: feistel-v1
  key_id: <application-key-id>
  rounds: 8
aliases:
  O: "0"
  I: "1"
  L: "1"
```

Example rendered shape:

```text
7KM-4Q2-H
```

This profile has `32^6 = 1,073,741,824` body combinations. The checksum adds validation but does not add identifier capacity.

A second frozen profile, `hrc32s-v1`, uses two checksum characters (grouping `[3, 3, 2]`) and provably detects all single-symbol substitutions and adjacent transpositions. Use it for unattended self-service lookup.

Permutation key material is never part of a frozen profile. Each application assigns its own `key_id` and key and stores them in a secret manager.

## Terminology

- **Internal ID**: The non-negative integer stored by the application.
- **Body**: Characters carrying the reversible encoded value.
- **Checksum**: One or more validation characters.
- **Canonical code**: The exact output emitted by the encoder.
- **Accepted input**: A user-entered form that normalizes to a canonical code.
- **Alphabet**: Ordered set of unique symbols used as base-N digits.
- **Alias**: Input symbol accepted as another canonical symbol.
- **Profile**: Versioned configuration that defines all codec behaviour.
- **Namespace**: External context that prevents codes from different domains being treated as interchangeable.

## Core formulas

For alphabet size `A` and body length `L`:

```text
capacity = A^L
```

For a required capacity `R`, the minimum body length is:

```text
minimum_length = ceil(log(R) / log(A))
```

A checksum does not increase capacity. It increases the number of displayed forms but only one checksum value is valid for each body.

## Architecture

```text
Internal ID
    |
    v
Optional reversible permutation
    |
    v
Base-N body encoding
    |
    v
Checksum calculation
    |
    v
Formatting
    |
    v
Displayed HRC
```

Decoding performs the reverse sequence:

```text
User input
    |
    v
Normalization and alias handling
    |
    v
Checksum validation
    |
    v
Base-N body decoding
    |
    v
Inverse permutation
    |
    v
Internal ID
```

## Versioning rule

Every persisted code must be decodable under the profile that created it. Use one of these approaches:

1. Store the `profile_id` beside the record.
2. Assign profiles by namespace and creation date.
3. Include an explicit version character in the code.

The recommended initial approach is storing `profile_id` with the record. Do not silently change an alphabet, checksum or permutation under an existing profile ID.

## Security rule

A reversible short code exposes a bounded identifier space. Applications must:

- Enforce authorization after lookup.
- Rate-limit public lookup endpoints.
- Avoid returning different error messages for missing and unauthorized records.
- Log abnormal enumeration attempts.
- Add a separate random secret when bearer-style access is required.

## Implementation order

1. Implement immutable profile validation.
2. Implement raw base-N encoding and decoding.
3. Implement checksum calculation and validation.
4. Implement normalization and aliases.
5. Implement optional permutation.
6. Add formatting.
7. Add the capacity calculator.
8. Add the reverse designer.
9. Run cross-language test vectors.
10. Freeze `hrc32-v1`.

## Acceptance summary

The implementation is complete when:

- Every value from `0` through `capacity - 1` round-trips.
- Invalid profiles are rejected.
- Invalid checksums are rejected.
- Aliases normalize only as configured.
- Ambiguous correction never returns an arbitrary result.
- Test vectors match in every supported language.
- The UI gives exact integer capacity without floating-point rounding.
