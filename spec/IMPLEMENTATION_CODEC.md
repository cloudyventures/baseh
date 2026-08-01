# baseH Codec Implementation

## 1. Scope

This document is normative. It defines profile validation, integer encoding, decoding, normalization, checksums, optional permutation, error handling and public APIs.

## 2. Data model

### 2.1 Profile

```typescript
type BasehProfile = {
  profileId: string;
  bodyAlphabet: string;
  bodyLength: number;
  checksumAlphabet: string;
  checksumLength: number;
  caseSensitive: boolean;
  separator: string;
  grouping: number[];
  aliases: Record<string, string>;
  permutation:
    | { enabled: false }
    | {
        enabled: true;
        algorithm: "feistel-v1";
        keyId: string;
        keyBytes: Uint8Array;
        rounds: number;
      };
};
```

### 2.2 Valid profile requirements

A profile is valid only when all conditions are true:

- `profileId` is non-empty.
- `bodyAlphabet` has at least two symbols.
- Every alphabet symbol is exactly one ASCII character.
- Body symbols are unique after case normalization.
- `bodyLength` is an integer from 1 through 32.
- `checksumLength` is an integer from 0 through 8.
- If `checksumLength` is positive, `checksumAlphabet` has at least two symbols.
- Checksum symbols are unique after case normalization.
- The separator does not occur in either alphabet.
- Every alias source is one ASCII character.
- Every alias target is a canonical body or checksum symbol.
- Alias application is idempotent.
- Alias chains are forbidden.
- Group sizes sum to `bodyLength + checksumLength`. When the separator is empty, `grouping` must be empty.
- A permutation key is present when permutation is enabled.
- Feistel rounds are an even integer from 4 through 16.

Reject invalid profiles during application startup, not during the first customer request.

## 3. Canonicalization

### 3.1 Input normalization order

Apply these steps in order:

1. Trim leading and trailing ASCII whitespace.
2. Remove configured separators.
3. Remove ASCII spaces if `acceptSpaces` is enabled by the caller.
4. Convert to uppercase when the profile is case-insensitive.
5. Apply direct aliases.
6. Reject any remaining symbol not in the body or checksum alphabet.
7. Verify exact unformatted length.
8. Split body and checksum.

Do not use Unicode compatibility normalization in version 1. Restricting the format to ASCII avoids lookalike characters from other scripts.

### 3.2 Direct aliases

The default profile accepts:

```text
O -> 0
I -> 1
L -> 1
```

These aliases are safe because the canonical body alphabet does not emit `O`, `I` or `L`.

An alias must never map two distinct canonical symbols into one value. Aliases expand accepted input but do not change canonical output.

### 3.3 Confusion candidates

Optional correction support may define small candidate sets such as:

```yaml
spoken_light:
  B: [D]
  D: [B]
  P: [T]
  T: [P]
```

Candidate sets are not direct aliases. They are used only after ordinary validation fails.

The decoder must:

1. Generate candidate codes within the configured correction budget.
2. Validate the checksum for each candidate.
3. Return a result only when exactly one distinct canonical code is valid.
4. Return `AMBIGUOUS_INPUT` when more than one is valid.
5. Return `INVALID_CHECKSUM` when none is valid.

The default correction budget is one substituted body symbol. Automatic correction of two or more symbols is disabled.

## 4. Capacity

For body alphabet size `A` and body length `L`:

```text
C = A^L
```

Allowed internal IDs are:

```text
0 <= id < C
```

Use arbitrary-precision integers. JavaScript implementations must use `bigint`, not `number`, when the profile may exceed `Number.MAX_SAFE_INTEGER`.

## 5. Raw base-N encoding

### 5.1 Algorithm

Given non-negative integer `value`, ordered alphabet `alphabet` and fixed length `length`:

```text
function encodeBaseN(value, alphabet, length):
    base = alphabet.length
    capacity = base ^ length

    if value < 0 or value >= capacity:
        error OUT_OF_RANGE

    output = array(length)

    for position from length - 1 down to 0:
        digit = value mod base
        output[position] = alphabet[digit]
        value = floor(value / base)

    return join(output)
```

### 5.2 Decoding

```text
function decodeBaseN(text, alphabet):
    base = alphabet.length
    index = map each alphabet symbol to its numeric value
    value = 0

    for symbol in text:
        if symbol not in index:
            error INVALID_CHARACTER

        value = value * base + index[symbol]

    return value
```

### 5.3 Fixed length

The encoder always emits exactly `bodyLength` body characters, including leading zero-value symbols.

## 6. Checksum

### 6.1 Requirements

The checksum must:

- Be deterministic.
- Include the profile ID or a profile-specific domain value.
- Include every body symbol in order.
- Be simple enough to implement consistently.
- Use only the configured safe checksum alphabet.

Detection strength is a property of the checksum modulus, not the profile as such. When the modulus `M` exceeds the maximum symbol-value delta (`bodyAlphabetSize - 1`) and the multiplier is coprime with `M`, all single-symbol substitutions and all adjacent transpositions are provably detected. When `M` is smaller, some structured errors evade detection and the measured rate must be published instead of claimed. All three checksummed frozen tiers (Light, Medium and Heavy, each with `M` between 21 and 24) are in the second category; none of the frozen tiers meets the first, and an application that needs provable total detection raises `checksumLength` in a custom profile rather than reaching for a frozen tier.

### 6.2 Version 1 checksum

Version 1 uses a keyed or unkeyed rolling polynomial over symbol values, followed by modulus conversion into the checksum alphabet.

Normative parameters:

```text
checksum_version = 1
initial_state = 17
multiplier = 37
domain = ASCII(profile_id) followed by 0x00
```

Procedure:

```text
function checksumValue(profileId, body, bodyIndex, modulus):
    state = 17

    for byte in ascii(profileId):
        state = (state * 37 + byte + 1) mod modulus

    state = (state * 37) mod modulus

    for position from 0 through body.length - 1:
        symbolValue = bodyIndex[body[position]]
        state = (state * 37 + symbolValue + position + 1) mod modulus

    return state
```

For checksum length `K` and checksum alphabet size `S`:

```text
modulus = S^K
```

Encode `checksumValue` as a fixed-length base-S string.

### 6.3 Detection limits

A checksum is error detection, not guaranteed correction. With modulus `M`, a random invalid body has approximately a `1/M` chance of matching a checksum. Structured errors can have different behaviour.

For the version 1 checksum, a single substitution at body position `p` changes the checksum value by `delta * 37^k mod M`, where `k` is the number of body positions after `p` and `delta` is the symbol-value change. Since `gcd(37, M) = 1` for every frozen tier, the substitution evades detection exactly when `delta` is a multiple of `M`. An adjacent transposition of values `a` and `b` changes the checksum by `36 * (a - b) * 37^k mod M`.

- `baseh-minimum-v1`: no checksum. Typo detection is impossible; every displayed string is a valid code.
- `baseh-light-v1` (`M = 24`, body values 0..30): deltas of `24` evade detection. That is 14 undetected cases out of `31 * 30 = 930` possible single-substitution errors per position, a structured miss rate of about 1.5 percent, plus the random `1/24` rate for other errors. Adjacent transpositions evade detection whenever the swapped values differ by an even number, since `36 * (a - b)` is always divisible by 24 when `a - b` is even. This is the weakest detection posture of the checksummed tiers and is why Light is aimed at typed, not spoken, workflows.
- `baseh-medium-v1` (`M = 23`, body values 0..27): deltas of `23` evade detection. That is 10 undetected cases out of `28 * 27 = 756` possible single-substitution errors per position, a structured miss rate of about 1.3 percent, plus the random `1/23` rate. Adjacent transpositions evade detection only when the swapped values differ by a multiple of 23, which is rare within a 28-symbol alphabet.
- `baseh-heavy-v1` (`M = 21`, body values 0..25): deltas of `21` evade detection. That is 10 undetected cases out of `26 * 25 = 650` possible single-substitution errors per position, a structured miss rate of about 1.5 percent, plus the random `1/21` rate. Adjacent transpositions evade detection when the swapped values differ by a multiple of 7.

All three checksummed tiers are suitable for assisted support where a human can ask for the code again after a failure. For unattended self-service lookup, configure a custom profile with `checksumLength` 2: at Medium (`M = 529`) or Heavy (`M = 441`) the modulus exceeds every possible symbol-value delta and adjacent-transposition change, so detection of both classes is provably total. Light at two symbols (`M = 576`) reaches total substitution detection but not total transposition detection, because `gcd(36, 576) = 36` leaves deltas that are multiples of 16 undetected.

### 6.4 Recommended production choice

Use one symbol for short support references when staff can ask for a repeat after failure. Use two symbols when codes drive self-service lookup without a human in the loop.

## 7. Optional reversible permutation

### 7.1 Purpose

Raw base-N encoding reveals sequence and approximate volume. A reversible permutation changes presentation order while preserving capacity and exact decoding.

It is not encryption. It prevents obvious sequential appearance but does not make the identifier secret.

### 7.2 Domain

The permutation operates over exactly:

```text
0 through capacity - 1
```

A normal block cipher over a larger power-of-two domain would create out-of-range outputs. Version 1 uses a balanced Feistel network with cycle walking.

### 7.3 Feistel-v1

Normative algorithm. All integer-to-byte conversions are unsigned big-endian unless stated otherwise.

1. Let `bits = ceil(log2(capacity))`. `capacity` is at least 2, so `bits >= 1`.
2. Define `w0 = bits - floor(bits / 2)` (the initial left-half width) and `w1 = floor(bits / 2)` (the initial right-half width). For odd `bits` the left half is one bit wider.
3. Split the input `value` into `left = value >> w1` (width `w0`) and `right = value mod 2^w1` (width `w1`).
4. Apply `rounds` rounds (`rounds` is an even integer from 4 through 16), for `i` from `0` to `rounds - 1`. Slot widths alternate each round: at the start of round `i`, `right` has width `wr(i)` and `left` has width `wl(i)`, where `wr(i) = w1` and `wl(i) = w0` for even `i`, and `wr(i) = w0` and `wl(i) = w1` for odd `i`. Each round:

   ```text
   F         = low wl(i) bits of HMAC-SHA-256(key, message_i)
   new_left  = right            (takes width wr(i))
   new_right = left XOR F       (keeps width wl(i))
   ```

   where `message_i` is exactly this byte sequence:

   ```text
   "BASEH-FEISTEL-V1" (14 ASCII bytes)
   0x00
   ASCII(profileId)
   0x00
   i as one byte (round number, 0-based)
   right as an unsigned big-endian integer in ceil(wr(i) / 8) bytes
       (zero bytes when wr(i) = 0)
   ```

   "Low N bits of HMAC-SHA-256" means: take the first `ceil(N / 8)` bytes of the 32-byte digest, interpret them as a big-endian integer and mask with `2^N - 1`. When `wr(i)` is 0, `right` is always 0 and the message ends after the round byte.

5. Because `rounds` is even, the final `left` has width `w0` and the final `right` has width `w1`. Recombine: `combined = (left << w1) | right`. `combined < 2^bits` always.
6. Cycle walking: if `combined >= capacity`, set `value = combined` and run the whole round sequence again from step 3. Stop when the result is inside the domain.
7. If a single encode or decode exceeds 1000 cycle-walk iterations, fail with `PERMUTATION_FAILURE`.

Expected walk count is under 2 because `2^bits / capacity < 2`. The ceiling only guards against implementation defects and degenerate profiles.

The inverse permutation runs the rounds in reverse. At round `i` the round that produced the current halves consumed a right value of width `wr(i)` equal to the current `left`, so:

```text
for i from rounds - 1 down to 0:
    prev_right = left
    prev_left  = right XOR low wl(i) bits of HMAC-SHA-256(key, message_i)
        where message_i is built exactly as in the forward direction
        from the current left value, encoded in ceil(wr(i) / 8) bytes
```

Cycle walking inverts identically: apply the inverse round sequence repeatedly until the result is inside the domain, with the same 1000-iteration ceiling.

### 7.4 Key management

- Store keys in the application's secret manager.
- Assign a stable `keyId`.
- Never change key material for an existing profile.
- Keep retired keys available for decoding.
- Do not put keys in frontend code.

### 7.5 Round function

The round function, message encoding and half-width rules are defined normatively in section 7.3. This subsection is kept only to note the origin of the construction: a standard HMAC-based Feistel network. Do not implement HMAC or SHA-256 manually; use the platform cryptographic library.

Implementations must match the published `feistel-vectors.json` test vectors byte for byte before the profile is frozen.

## 8. Full encode flow

```text
function encode(id, profile):
    validateProfile(profile)
    capacity = pow(len(profile.bodyAlphabet), profile.bodyLength)

    if id < 0 or id >= capacity:
        error OUT_OF_RANGE

    value = id

    if profile.permutation.enabled:
        value = permute(value, capacity, profile.permutation)

    body = encodeBaseN(
        value,
        profile.bodyAlphabet,
        profile.bodyLength
    )

    checksum = calculateChecksum(profile, body)
    raw = body + checksum

    if profile.profanity.mode == "blocklist":
        if any effective blocklist word is a case-insensitive
           substring of raw:   # section 18
            error BLOCKED_CODE

    return format(raw, profile.grouping, profile.separator)
```

## 9. Full decode flow

```text
function decode(input, profile, options):
    validateProfile(profile)
    raw = normalize(input, profile, options)

    body = raw[0:profile.bodyLength]
    suppliedChecksum = raw[profile.bodyLength:]

    if body contains a symbol outside the body alphabet:
        error INVALID_CHARACTER
    # Such a symbol can reach this point because normalization checks
    # membership in the union of both alphabets (step 6 in 3.1).

    if not checksumMatches(body, suppliedChecksum, profile):
        if not options.tryCorrection:
            error INVALID_CHECKSUM

        candidates = generateCandidates(body, profile, options)

        valid = []
        for candidateBody in candidates:
            if checksumMatches(candidateBody, suppliedChecksum, profile):
                valid.append(candidateBody)

        valid = unique(valid)

        if len(valid) == 0:
            error INVALID_CHECKSUM

        if len(valid) > 1:
            error AMBIGUOUS_INPUT

        body = valid[0]

    value = decodeBaseN(body, profile.bodyAlphabet)

    if profile.permutation.enabled:
        value = inversePermute(
            value,
            capacity(profile),
            profile.permutation
        )

    canonical = encode(value, profile)

    return {
        id: value,
        canonicalCode: canonical,
        corrected: canonicalize(input) != canonicalize(canonical)
    }
```

## 10. Candidate generation

### 10.1 Rules

- Generate only substitutions listed in the selected confusion profile.
- Never generate insertions or deletions in version 1.
- Never alter checksum characters during correction.
- Default maximum edit count is one.
- Cap generated candidates at 64.
- Deduplicate before checksum work.

### 10.2 Pseudocode

```text
function generateCandidates(body, confusionMap, maxEdits = 1):
    results = set()

    for position in body positions:
        source = body[position]

        for replacement in confusionMap[source]:
            candidate = body with position replaced
            results.add(candidate)

            if len(results) > 64:
                error TOO_MANY_CANDIDATES

    return results
```

## 11. Formatting

Formatting is presentation only.

Example:

```yaml
grouping: [3, 4]
separator: "-"
```

Raw:

```text
7KM4Q2H
```

Formatted:

```text
7KM-4Q2H
```

The decoder accepts the configured separator at expected positions. A lenient UI may remove separators before calling the codec. The library itself should reject unexpected punctuation unless the caller explicitly enables lenient mode.

The web tools pick `grouping` from the total displayed length (`bodyLength + checksumLength`) with one fixed rule, so a configuration transferred between the tools and a frozen profile keeps the same visual rhythm: no delimiter at 3 or fewer characters; groups of 2 at 4; groups of 3 up to 6; groups of 4 up to 8; groups of 5 beyond that, with any leftover short group trailing. The frozen Minimum tier uses this rule directly: 6 characters with a hyphen, `[3, 3]`.

## 12. Public API

### 12.1 Encode

```typescript
encode(
  id: bigint,
  profile: BasehProfile
): string
```

Errors:

- `INVALID_PROFILE`
- `OUT_OF_RANGE`
- `PERMUTATION_FAILURE`

### 12.2 Decode

```typescript
decode(
  input: string,
  profile: BasehProfile,
  options?: {
    acceptSpaces?: boolean;
    tryCorrection?: boolean;
    confusionProfile?: "none" | "light" | "medium" | "heavy";
    maxCorrections?: 0 | 1;
  }
): {
  id: bigint;
  canonicalCode: string;
  corrected: boolean;
}
```

Errors:

- `INVALID_PROFILE`
- `INVALID_LENGTH`
- `INVALID_CHARACTER`
- `INVALID_CHECKSUM`
- `AMBIGUOUS_INPUT`
- `TOO_MANY_CANDIDATES`
- `PERMUTATION_FAILURE`

### 12.3 Capacity

```typescript
capacity(profile: BasehProfile): bigint
```

### 12.4 Validate

```typescript
validate(
  input: string,
  profile: BasehProfile
): {
  valid: boolean;
  canonicalCode?: string;
  reason?: BasehErrorCode;
}
```

## 13. Error object

```json
{
  "code": "INVALID_CHECKSUM",
  "message": "The reference code did not pass validation.",
  "safeForCustomer": true,
  "details": {
    "profileId": "baseh-medium-v1"
  }
}
```

Do not include candidate internal IDs in customer-visible errors.

## 14. Storage

Recommended record fields:

```sql
internal_id BIGINT PRIMARY KEY,
baseh_profile_id VARCHAR(64) NOT NULL,
baseh_code VARCHAR(64) GENERATED OR STORED,
created_at TIMESTAMP NOT NULL
```

The canonical code may be generated on demand. Store it when:

- Search by code must use a normal indexed column.
- The profile uses an external or expensive permutation.
- Audit requirements need the original rendered value.

Add a unique index on `(baseh_profile_id, baseh_code)` when stored.

## 15. Concurrency

The codec is pure and stateless. Thread safety depends only on immutable profile and key objects.

## 16. Compatibility

Each language implementation must:

- Use ASCII bytes for profile IDs.
- Use unsigned arithmetic or arbitrary precision.
- Match the normative checksum order.
- Match Feistel byte ordering.
- Pass the shared vectors.
- Reject the same malformed profiles.

## 17. Reference defaults

Four frozen tiers ship with the library. Each is the full alphanumeric set with cumulative visual and spoken strips applied exactly as the web tools derive them; all four run the default profanity blocklist (section 18) and keep the typed `O`/`I`/`L` aliases. `baseh-medium-v1` is the documented default.

| Tier | Symbols | Checksum | Delimiter | Capacity | Use for |
|---|---|---|---|---|---|
| `baseh-minimum-v1` | 36 | none | hyphen, `[3, 3]` | 2,176,782,336 | Typed contexts where typos are caught downstream |
| `baseh-light-v1` | 31 | 1 | none | 887,503,681 | Typed workflows with light safety |
| `baseh-medium-v1` | 28 | 1 | none | 481,890,304 | General use; the default |
| `baseh-heavy-v1` | 26 | 1 | none | 308,915,776 | Spoken-first workflows |

`baseh-medium-v1`, the default:

```json
{
  "profileId": "baseh-medium-v1",
  "bodyAlphabet": "0123456789ACDEFGHJKMPQRUVXYZ",
  "bodyLength": 6,
  "checksumAlphabet": "234679ACDEFGHJKMPQRUVXY",
  "checksumLength": 1,
  "caseSensitive": false,
  "separator": "",
  "grouping": [],
  "aliases": {
    "O": "0",
    "I": "1",
    "L": "1",
    "T": "P",
    "N": "M",
    "W": "V"
  },
  "permutation": {
    "enabled": false
  },
  "profanity": {
    "mode": "blocklist"
  }
}
```

`baseh-minimum-v1`: `bodyAlphabet` is the full `"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"`, `checksumAlphabet` is empty, `checksumLength` is 0, `separator` is `"-"`, `grouping` is `[3, 3]` and `aliases` is empty, because every alphanumeric symbol is canonical.

`baseh-light-v1`: `bodyAlphabet` `"0123456789ABCEFGHJKMNPQRSUVWXYZ"`, `checksumAlphabet` `"234679ACEFGHJKMNPQRUVWXY"`, no separator or grouping, aliases adding `"D": "B"` and `"T": "P"` to the `O`/`I`/`L` set.

`baseh-heavy-v1`: `bodyAlphabet` `"0123456789ABCEFHJKMPQRVXYZ"`, `checksumAlphabet` `"234679ACEFHJKMPQRUVXY"`, no separator or grouping, aliases adding `"D": "B"`, `"T": "P"`, `"N": "M"`, `"W": "V"`, `"S": "F"` and `"G": "C"` to the `O`/`I`/`L` set.

Each tier also ships a keyed variant whose `profileId` gains a `-p` segment (`baseh-minimum-p-v1` through `baseh-heavy-p-v1`): identical to the plain tier but with Feistel-v1 permutation enabled, requiring caller-supplied key material (section 7). Application-specific permutation keys are never part of a frozen profile and each application assigns its own `keyId` and key material. Profile helpers return a freshly built, mutable profile object on every call, so an application can load a default and then modify it (longer body, custom separator, no profanity blocklist) without mutating the frozen definition from which it started. Freeze the tiers' checksum and Feistel test vectors before production use.

## 18. Profanity safety

Profiles gain an optional `profanity` object. It never changes decode
behavior for issued codes and never changes identifier capacity accounting:
blocked codes are simply never issued by the encoder.

```json
{
  "profanity": {
    "mode": "none | no-vowels | blocklist",
    "words": ["..."],
    "extraWords": ["..."]
  }
}
```

### 18.1 Modes

- `none` (default for custom profiles): no filtering. The four frozen
  tiers all use `blocklist` instead (section 17).
- `no-vowels`: before any other profile-derived computation, the vowels
  `A`, `E`, `I`, `O` and `U` (after case normalization) are removed from the
  body alphabet and the checksum alphabet. All downstream rules apply to the
  stripped alphabets: capacity, base-N conversion, the checksum modulus,
  separator collision checks and alias target validation. If stripping
  leaves the body alphabet (or the checksum alphabet when `checksumLength`
  is positive) with fewer than two symbols, the profile is invalid
  (`INVALID_PROFILE`). An alias whose source is a stripped vowel remains
  valid and lets users type vowels without failure.
- `blocklist`: the encoder rejects any code whose raw unformatted string
  contains a blocked substring (section 18.2).

### 18.2 Effective blocklist

The effective list is:

```text
words if present (replacing the default list)
otherwise the default list
plus extraWords in either case
```

Entries are ASCII letters, normalized to uppercase when the profile is
case-insensitive, deduplicated. Matching is a case-insensitive substring
scan over the raw code (body + checksum, before formatting). On a match the
encoder fails with `BLOCKED_CODE`. `decode` may also raise `BLOCKED_CODE`
when reconstructing the canonical form, since a blocked string could never
have been issued.

The default list is deliberately small and targets the worst outcomes;

applications needing real coverage supply `words` or `extraWords`:

```text
CRAP TWAT SHAG DAMN FCK FUC SHT CNT TWT DCK AZZ BCH
```

### 18.3 BLOCKED_CODE error

Added to the error taxonomy: the generated or decoded code contains a
blocked substring. `safeForCustomer` is false: this is an issuance decision,
not an end-user condition. Applications should advance their sequence by one
and retry encoding.

### 18.4 Known limitation

Substring matching false-positives on innocent strings containing the
substring (the Scunthorpe problem). Keep lists short and curated; prefer
`no-vowels` for broad prevention and `blocklist` for specific terms.
