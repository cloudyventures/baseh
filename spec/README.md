# baseH

## Status

Implementation specification.

## Purpose

baseH is base36 reworked for humans. It converts non-negative integers into short alphanumeric references that people can read, type and dictate, using an alphabet chosen to avoid transcription confusion plus a checksum. It is intended for order numbers, support tickets, cases, returns, bookings and similar records.

The encoded value is reversible. A system can convert an internal numeric identifier into a baseH and convert a valid baseH back into the same identifier.

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

An baseH is a reference alias. Access control must not depend on its secrecy.

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

The library ships four frozen tiers; `baseh-medium-v1` is the recommended default:

```yaml
profile_id: baseh-medium-v1
body_alphabet: "0123456789ACDEFGHJKMPQRUVXYZ"
body_length: 6
checksum_alphabet: "234679ACDEFGHJKMPQRUVXY"
checksum_length: 2
case_sensitive: false
grouping: [4, 4]
separator: "-"
permutation:
  enabled: true
  algorithm: feistel-v1
  key_id: frozen
  key_bytes_hex: "62617365682d66726f7a656e2d6b65792d7631"
  rounds: 8
profanity:
  mode: blocklist
aliases:
  O: "0"
  I: "1"
  L: "1"
  T: "P"
  N: "M"
  W: "V"
```

Example rendered shape:

```text
C8XP-8J49
```

This profile has `28^6 = 481,890,304` body combinations. The checksum adds validation but does not add identifier capacity.

The other tiers bracket it: `baseh-minimum-v1` (full 36-symbol alphanumeric, no checksum, hyphen grouped `[3, 3]`, `36^6 = 2,176,782,336` combinations) for typed contexts, `baseh-light-v1` (31 symbols, 2 checksums, hyphen grouped `[4, 4]`, `31^6 = 887,503,681`) for typed workflows with light safety and `baseh-heavy-v1` (26 symbols, 2 checksums, hyphen grouped `[4, 4]`, `26^6 = 308,915,776`) for spoken-first workflows. All four run the default profanity blocklist and all four permute with the same frozen published key.

With two checksum symbols the checksummed tiers provably detect every single-symbol substitution, and Medium and Heavy detect every adjacent transposition as well (see `IMPLEMENTATION_CODEC.md` section 6.3). That is what makes the frozen tiers suitable for unattended self-service lookup.

Permutation is always on in the plain tiers, keyed with the published frozen key (`IMPLEMENTATION_CODEC.md` section 7.5) so the zero-argument helpers work out of the box. The frozen key hides sequence only; it is not a secret. An application that wants a private mapping uses a `-p` variant and passes its own key; that key is never part of a frozen profile and the key holder must store it in a secret manager. See `IMPLEMENTATION_CODEC.md` section 7.

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
Displayed baseH
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
10. Freeze the four tiers.

## Acceptance summary

The implementation is complete when:

- Every value from `0` through `capacity - 1` round-trips.
- Invalid profiles are rejected.
- Invalid checksums are rejected.
- Aliases normalize only as configured.
- Ambiguous correction never returns an arbitrary result.
- Test vectors match in every supported language.
- The UI gives exact integer capacity without floating-point rounding.
