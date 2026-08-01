# baseH Test Suite

## 1. Purpose

This document defines tests required before a profile can be frozen or a codec implementation can be released.

## 2. Test layers

1. Profile validation tests.
2. Base-N unit tests.
3. Checksum unit tests.
4. Normalization and alias tests.
5. Full round-trip tests.
6. Correction tests.
7. Permutation tests.
8. Cross-language vectors.
9. Property tests.
10. Fuzz tests.
11. UI formula tests.
12. Browser tests.
13. Performance tests.
14. Security tests.

## 3. Profile validation

Test rejection of:

- Empty profile ID.
- Body alphabet with fewer than two symbols.
- Duplicate body symbols.
- Case collision under case-insensitive mode.
- Non-ASCII symbol.
- Zero body length.
- Negative body length.
- Body length above limit.
- Negative checksum length.
- Checksum alphabet too small.
- Separator contained in body alphabet.
- Separator contained in checksum alphabet.
- Alias target not canonical.
- Alias chain.
- Alias cycle.
- Group total mismatch.
- Missing permutation key.
- Odd Feistel round count.
- Too few or too many rounds.

Test acceptance of every shipped profile.

## 4. Base-N tests

For alphabet `0123456789ABCDEF`, length 4:

| ID | Expected body |
|---:|---|
| 0 | `0000` |
| 1 | `0001` |
| 15 | `000F` |
| 16 | `0010` |
| 255 | `00FF` |
| 256 | `0100` |
| 65535 | `FFFF` |

Test:

- Negative ID rejected.
- ID equal to capacity rejected.
- Leading zero symbols preserved.
- Every alphabet symbol maps to the correct numeric digit.
- Decoding invalid character fails.
- Empty body fails.
- Lowercase input succeeds only when configured.

## 5. Default profile boundary tests

Default body alphabet size:

```text
32
```

Default length:

```text
6
```

Capacity:

```text
1,073,741,824
```

Boundary IDs:

```text
0
1
31
32
33
1,073,741,822
1,073,741,823
```

Verify:

```text
decode(encode(id)) == id
```

and:

```text
encode(1,073,741,824) -> OUT_OF_RANGE
```

## 6. Checksum tests

Freeze exact vectors after the reference implementation is approved.

Required test categories:

- Same body and profile always produce same checksum.
- One changed body symbol normally changes checksum.
- Body position affects checksum.
- Profile ID affects checksum.
- Leading zero-value symbols affect checksum.
- Checksum alphabet conversion preserves fixed width.
- Supplied checksum with wrong length fails.
- Checksum characters outside alphabet fail.
- Zero checksum length skips checksum work.

Sampled single-substitution detection sweep for each checksummed frozen tier (Light, Medium and Heavy):

```text
For at least 100,000 sampled bodies:
    For every body position:
        For every other canonical symbol:
            Substitute symbol.
            Record whether the checksum fails.
```

Every checksummed frozen tier ships two checksum symbols and must assert total single-substitution detection in this sweep (spec section 6.3): zero misses at Light, Medium and Heavy. An adjacent-transposition sweep must likewise record zero misses at Medium and Heavy, and exactly the documented Light misses (swapped values differing by a multiple of 16). A custom one-symbol profile records the measured miss counts instead of asserting totality.

## 7. Alias tests

Default aliases:

```text
O -> 0
I -> 1
L -> 1
```

Tests:

- Canonical `0` decodes.
- Alias `O` decodes to the same ID.
- Canonical `1` decodes.
- Alias `I` decodes to the same ID.
- Alias `L` decodes to the same ID.
- Encoder never emits `O`, `I` or `L`.
- Alias matching is case-insensitive only when configured.
- Unknown alias fails.
- Alias in checksum is accepted only when the checksum alphabet defines it.
- Alias application is idempotent.

## 8. Formatting tests

For grouping `[3, 4]`:

- Encoder emits separators at exact positions.
- Decoder accepts canonical separators.
- Decoder rejects double separators in strict mode.
- Decoder rejects wrong separator in strict mode.
- Lenient caller can remove ASCII spaces.
- Leading or trailing whitespace is trimmed.
- Internal whitespace fails unless enabled.
- Formatting does not change decoded ID.

## 9. Correction tests

For each configured pair:

- Start with a valid canonical code.
- Replace one body symbol with its paired confusion symbol.
- Confirm ordinary validation fails when it is not a direct alias.
- Confirm correction mode finds the canonical code when exactly one candidate passes.
- Confirm `corrected` is true.
- Confirm returned canonical code is exact.

Ambiguity test:

- Construct or search for an input where two candidate bodies pass.
- Confirm decoder returns `AMBIGUOUS_INPUT`.
- Confirm decoder does not choose the first candidate.
- Confirm no internal ID is returned.

No-result test:

- Change a symbol outside the candidate map.
- Confirm `INVALID_CHECKSUM`.

Candidate cap test:

- Supply a map that would exceed 64 generated candidates.
- Confirm `TOO_MANY_CANDIDATES`.

## 10. Permutation tests

Before freezing Feistel-v1, publish fixed vectors containing:

- Profile ID.
- Key bytes as hexadecimal.
- Capacity.
- Round count.
- Input.
- Permuted value.
- Inverse result.
- Cycle-walk count.

Properties:

- `inverse(permute(x)) == x`.
- Every output is inside the domain.
- No duplicate output for exhaustive small domains.
- Boundary values round-trip.
- Different keys produce different mappings.
- Different profile IDs produce different mappings.
- Same inputs produce identical mappings across languages.
- Cycle walking terminates within a configured ceiling.

For small capacities up to 100,000, exhaustively verify bijection.

## 11. Property testing

### 11.1 Round trip

Generate valid profiles and IDs:

```text
decode(encode(id, profile), profile).id == id
```

### 11.2 Canonical stability

```text
encode(decode(code).id) == decode(code).canonicalCode
```

### 11.3 Capacity

For any valid profile:

```text
0 <= decoded_id < capacity(profile)
```

### 11.4 Fixed length

Raw encoded length equals:

```text
body_length + checksum_length
```

### 11.5 No emitted alias sources

Encoder output contains only canonical alphabet symbols.

### 11.6 Solver soundness

Every code designer candidate satisfies every hard constraint.

### 11.7 Solver minimality

Compare recommendation to brute force for standard search spaces.

## 12. Fuzz testing

Fuzz inputs:

- Empty strings.
- Random ASCII.
- Random Unicode.
- Very long strings.
- Repeated separators.
- Null bytes where the language permits.
- Mixed case.
- Confusable Unicode characters.
- Invalid UTF-8 at API boundaries.
- Inputs near maximum configured length.
- Random profiles.
- Corrupt exported JSON.

Invariants:

- No crash.
- No unbounded allocation.
- No excessive candidate generation.
- No internal ID returned on failure.
- Error category is stable.
- Runtime is bounded by input length and candidate cap.

## 13. Cross-language vectors

Use a shared JSON file:

```json
{
  "version": "1",
  "profiles": [],
  "vectors": [
    {
      "profileId": "baseh-medium-v1",
      "id": "0",
      "canonicalCode": "..."
    }
  ]
}
```

Rules:

- Large integers are decimal strings.
- Keys are hexadecimal strings, used in test-only profiles and in the published frozen tier key.
- JSON is ASCII.
- Vectors are reviewed and versioned.
- A release fails if any supported implementation disagrees.

## 14. Capacity calculator tests

Exact cases:

| Alphabet | Length | Capacity |
|---:|---:|---:|
| 10 | 3 | 1,000 |
| 10 | 6 | 1,000,000 |
| 16 | 5 | 1,048,576 |
| 32 | 5 | 33,554,432 |
| 32 | 6 | 1,073,741,824 |
| 36 | 5 | 60,466,176 |
| 36 | 6 | 2,176,782,336 |

Verify checksum length leaves body capacity unchanged.

Verify displayed combinations:

```text
body_capacity * checksum_states
```

but the UI labels them as non-valid combinations.

## 15. Code designer tests

Cases:

1. Required `33,554,432`, base 32 selects length 5.
2. Required `33,554,433`, base 32 selects length 6.
3. Required `1,073,741,824`, base 32 selects length 6.
4. Required `1,073,741,825`, base 32 selects length 7.
5. Maximum displayed length too short produces no candidate.
6. Minimum checksum length is respected.
7. Maximum utilization removes overly full candidates.
8. Hard alphabet restriction is respected.
9. Deterministic tie-breaking is stable.
10. Export round-trips without numeric precision loss.

## 16. API tests

- Correct content type.
- Missing code rejected.
- Missing namespace rejected when required.
- Unknown profile handled without information leak.
- Unauthorized and missing records have equivalent external response.
- Rate limit enforced.
- Large request body rejected.
- Logs mask code values.
- Internal exceptions map to safe errors.

## 17. Performance targets

Reference targets on a current server CPU:

- Encode without permutation: p99 below 50 microseconds.
- Decode without correction: p99 below 75 microseconds.
- Decode with one-edit correction: p99 below 500 microseconds.
- Profile validation: below 1 millisecond.
- Capacity calculation: below 1 millisecond.
- Designer standard search: below 50 milliseconds in browser.
- No request allocates more than 1 MB for normal inputs.

Treat these as initial budgets, not guarantees. Record actual benchmark hardware.

## 18. Security testing

- Attempt sequential enumeration.
- Confirm rate limiting.
- Confirm authorization after successful decode.
- Confirm permutation key is absent from browser bundles.
- Confirm profile export omits secrets.
- Confirm timing does not reveal record existence beyond normal network noise.
- Confirm malformed inputs cannot trigger expensive unbounded correction.
- Confirm logs do not contain sensitive record data.
- Confirm profile ID cannot select arbitrary files or keys.

## 19. Release gates

A profile may be frozen only when:

- Normative vectors are approved.
- All implementations pass the same vectors.
- Exhaustive small-domain permutation tests pass.
- Single-substitution checksum performance is measured.
- Fuzzing runs for at least 24 cumulative CPU hours without a crash.
- Security review is complete.
- Documentation matches implementation.
- Profile ID and key ID are immutable.

## 20. Expandable mode tests

Expandable mode (codec spec section 19) requires its own vector and
property coverage, in addition to every fixed-mode suite above running
unchanged.

### 20.1 Per-generation round trips at boundaries

For `baseh-expandable-v1` and at least one custom expandable profile:

- Round-trip the first and last id of each generation from `minLength`
  through at least length 8: `generationBase(L)`, `generationBase(L) - 1`,
  `generationBase(L + 1) - 1` and `generationBase(L + 1)`.
- Assert the encoded total length equals the generation length at every
  boundary (id `1,155` encodes at 4 characters, id `1,156` at 5, for the
  frozen tier).
- Assert every canonical code has a non-zero leading body symbol (the zero
  ban makes this structurally guaranteed; the test pins it).
- Exhaustively round-trip every id of the smallest generation(s) where
  practical (`34^2 = 1,156` ids at length 4 for the frozen tier).

### 20.2 Zero-ban rejections

- Presented `0` in any body position fails `INVALID_CHARACTER`.
- Presented `O` in any body position fails `INVALID_CHARACTER` (after the
  `O -> 0` alias resolves).
- A custom expandable alphabet containing `0` and `O` is silently stripped
  during profile preparation and validates; tooling displays the derived
  alphabet.

### 20.3 Checksum-with-zero cases

- Find and pin vectors whose canonical checksum contains `0`; confirm they
  encode, decode and round-trip.
- A typed `O` in a checksum position aliases to `0` and decodes to the
  same id with `corrected` false: alias resolution is normalization, not
  correction (codec spec section 9 defines `corrected` as
  `canonicalize(input) != canonicalize(canonical)`, and aliasing happens
  before `canonicalize`).
- The checksum modulus for the frozen expandable tier is `35^2 = 1,225`;
  run the sampled single-substitution and adjacent-transposition sweeps of
  section 6 at several generations and assert zero misses (codec spec
  section 17.1).

### 20.4 No-left-pad rejections

- Normalized input shorter than `minLength` fails `INVALID_LENGTH`, even
  when it would be a valid fixed-mode stripped-zero form.
- No expandable decode ever inserts leading symbols; `canonicalCode`
  always has exactly the presented length.
- Normalized input longer than 32 symbols fails `INVALID_LENGTH`.

### 20.5 Separator threshold rendering

- Below `separatorMinLength` the encoder emits no separator and the
  decoder rejects one: for the frozen tier, lengths 4 and 5 render bare.
- At and above the threshold the balanced grouping rule of codec spec
  section 19.5 applies: pin the exact rendered shapes for lengths 6 through
  10 (`XXX-XXX`, `XXXX-XXX`, `XXXX-XXXX`, `XXXXX-XXXX`, `XXXXX-XXXXX`),
  and unit-test the grouping split against the pinned table for total
  lengths 4 through 16 (2+2, 3+2, 3+3, 4+3, 4+4, 5+4, 5+5, 4+4+3,
  4+4+4, 5+4+4, 5+5+4, 5+5+5, 4+4+4+4).

### 20.6 Cross-generation wrong-length rejection

- Take a valid canonical code, append or remove one symbol, and confirm
  `INVALID_CHECKSUM` (or `INVALID_CHARACTER` / `INVALID_LENGTH` where the
  edit hits those rules first). The appended form must never decode to any
  id of the shorter generation.
- Correction mode (`tryCorrection`) never returns a candidate at a
  different length than the presented input; ambiguous cases still return
  `AMBIGUOUS_INPUT`.

### 20.7 Mixed-mode interop

- Every pre-existing fixed-mode vector in the shared `vectors.json` passes
  unchanged against the same implementation build that supports expandable
  mode.
- Fixed-mode profiles constructed with an explicit `mode: "fixed"` behave
  byte-for-byte identically to profiles predating the mode field.
- Decoders never infer mode from input: a four-character code presented to
  a fixed tier fails exactly as before, and an eight-character code
  presented to the expandable tier decodes only per section 19.7.
- Expandable vectors live in the shared vector file with the profile's
  mode recorded; a release fails if any implementation disagrees on any
  generation boundary vector.

## 21. Repetition filter tests

Section references are to `IMPLEMENTATION_CODEC.md` section 21.

- **Validation.** `maxRepetition` of `1` or `2` is rejected with
  `INVALID_PROFILE`; `0` (off), `3`, and a value above the code length (a
  legal no-op) are accepted. A profile without the field prepares as `0`.
- **Boundary, blocked.** With `maxRepetition: 4`, an id whose raw code
  contains a run of exactly 4 fails encode with `BLOCKED_CODE`. Pinned in
  the shared vector file (`rep32-test` in `encodeErrors`).
- **Boundary, allowed.** With `maxRepetition: 4`, an id whose raw code's
  longest run is exactly 3 encodes and round-trips. Pinned (`rep32-test`
  round-trip vector).
- **Off at 0.** A profile with `maxRepetition: 0` (or no field) encodes ids
  whose raw codes contain runs of any length.
- **Custom floor.** With `maxRepetition: 3`, a normal id round-trips and an
  id whose raw code contains a triple fails encode with `BLOCKED_CODE`.
  Pinned (`rep3-32-test` round-trip and `encodeErrors` entries).
- **Separators do not break a run.** A code rendered `AA-AA…` under a
  separator has no formatted group showing a run of 4, but its raw code is
  `AAAA…` — a run of 4 — and must be blocked (section 21.2). Pinned
  (`rep16-sep-test` in `encodeErrors`).
- **Decode consistency.** Decoding a code whose raw form violates
  `maxRepetition` (constructible only with the filter off) fails with
  `BLOCKED_CODE`, matching blocklist decode semantics (section 21.3).
- **Correction consistency.** Correction must never correct into a blocked
  code: when the sole checksum-valid candidate carries a blocked run,
  decode fails with `BLOCKED_CODE` instead of returning the candidate
  (section 21.3).
- **Frozen tiers.** Every frozen tier — the four fixed tiers, their `-p`
  variants, and the expandable tier — ships `maxRepetition: 4` (pinned in
  the shared profile definitions) and rejects a brute-forced id whose raw
  code has a run of 4.
- **Issuance skip.** The standard issuance loop (catch `BLOCKED_CODE`,
  advance the id, retry) encodes the next id successfully after a blocked
  one.
- **Vector integrity.** Pre-existing shared vectors are byte-identical
  except frozen-tier profile definitions (which gain `maxRepetition: 4`) and
  the fixed-tier stripped-leading-zero decode vectors, which move to the
  error list as `BLOCKED_CODE` because those zero-heavy codes are now
  unissuable on the frozen tiers. No emitted code string changes anywhere:
  the filter only blocks, it never alters a code.
