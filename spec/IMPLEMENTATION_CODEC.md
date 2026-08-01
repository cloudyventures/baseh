# baseH Codec Implementation

## 1. Scope

This document is normative. It defines profile validation, integer encoding, decoding, normalization, checksums, optional permutation, error handling and public APIs.

## 2. Data model

### 2.1 Profile

```typescript
type BasehProfile = {
  profileId: string;
  mode: "fixed" | "expandable";
  bodyAlphabet: string;
  bodyLength: number;       // fixed mode only; ignored in expandable mode
  minLength: number;        // expandable mode only; default 4
  checksumAlphabet: string;
  checksumLength: number;
  caseSensitive: boolean;
  separator: string;
  separatorMinLength: number; // expandable mode only; default 0
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
- `mode` is `"fixed"` or `"expandable"`. A profile constructed without a
  mode is treated as `"fixed"`: pre-`mode` persisted profiles and all
  version 1 and version 2 frozen tier definitions (section 17) carry no
  `mode` field and must keep decoding byte-identically, so backward
  compatibility pins the default to `"fixed"`. Expandable mode is the
  RECOMMENDED mode for new profiles, but any newly authored or frozen
  profile must declare its mode explicitly, and a decoder must never guess
  the mode from the presented input. All version 1 and version 2 frozen
  tiers (section 17) are `"fixed"` and are unchanged by this document's
  expandable-mode rules.
- `bodyAlphabet` has at least two symbols.
- Every alphabet symbol is exactly one ASCII character.
- Body symbols are unique after case normalization.
- In fixed mode, `bodyLength` is an integer from 1 through 32. In
  expandable mode `bodyLength` is ignored.
- In expandable mode, `minLength` is an integer of at least 1 (default 4)
  and must be greater than `checksumLength`, so every generation carries at
  least one body symbol.
- In expandable mode, the prepared body alphabet must not contain `0` or
  `O` (the zero ban, section 19.2). Profile preparation removes both
  symbols silently — including from a custom alphabet — before any other
  validation, and validation then asserts their absence like any other
  profile invariant.
- `checksumLength` is an integer from 0 through 8.
- If `checksumLength` is positive, `checksumAlphabet` has at least two symbols.
- Checksum symbols are unique after case normalization.
- The separator does not occur in either alphabet.
- Every alias source is one ASCII character.
- Every alias target is a canonical body or checksum symbol.
- Alias application is idempotent.
- Alias chains are forbidden.
- In fixed mode, group sizes sum to `bodyLength + checksumLength`, and
  `separatorMinLength` must be 0. In expandable mode the sum rule does not
  apply and `grouping` must be empty: the split is a pure function of the
  total length under the balanced grouping rule (section 19.5), so a
  configurable pattern would be meaningless; `separatorMinLength` is an
  integer of at least 0 (default 0). In either mode, when the separator is
  empty, `grouping` must be empty.
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
7. Fixed mode only: re-pad leading zeros when the input is short (3.4).
   Expandable mode never re-pads (section 19.2).
8. Verify the unformatted length: exactly `bodyLength + checksumLength` in
   fixed mode; at least `minLength` in expandable mode, where the length
   selects the generation (section 19.7).
9. Split body and checksum.

Do not use Unicode compatibility normalization in version 1. Restricting the format to ASCII avoids lookalike characters from other scripts.

### 3.2 Direct aliases

The default profile accepts:

```text
O -> 0
I -> 1
L -> 1
```

These aliases are safe because the canonical body alphabet does not emit `O`, `I` or `L`.

The same rule extends to every look-alike a visual safety drop removes: a symbol that can never be issued has exactly one possible meaning in a typed code. The frozen Medium tier drops `B` and `S` for looking like `8` and `5`, so it also accepts:

```text
B -> 8
S -> 5
```

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

### 3.4 Stripped leading zeros (fixed mode only)

This section applies to fixed-mode profiles only. Expandable mode has no
left-padding and no stripped-zero leniency (section 19.2); presented input
shorter than `minLength` fails `INVALID_LENGTH`.

Humans naturally drop leading zero symbols when reading or typing a code
(`000001D` becomes `1D`). The decoder must accept this form:

- When the normalized input is shorter than `bodyLength + checksumLength`
  but still holds at least `checksumLength` symbols (at least one symbol
  when there is no checksum), left-pad it with the body zero symbol up to
  the exact length, then continue.
- The checksum symbols are always retained by the human, so the body and
  checksum split stays unambiguous.
- A short input that is not a stripped valid code fails `INVALID_CHECKSUM`,
  not `INVALID_LENGTH`. Over-long input still fails `INVALID_LENGTH`.
- A fully stripped no-checksum code would be the empty string and stays
  `INVALID_LENGTH`.

This is decode-only leniency. The encoder always emits the fixed-width
canonical code and `canonicalCode` in the decode result stays fixed width.

## 4. Capacity

For body alphabet size `A` and body length `L`:

```text
C = A^L
```

Allowed internal IDs are:

```text
0 <= id < C
```

This is the fixed-mode model. Expandable mode has no single capacity: each
total length `L` is a generation covering `A^(L - checksumLength)` ids, and
the generations tile the non-negative integers contiguously (section 19.1).

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

In fixed mode the encoder always emits exactly `bodyLength` body characters, including leading zero-value symbols. In expandable mode the encoder emits exactly `L - checksumLength` body characters for the selected generation `L`, and the zero ban (section 19.2) guarantees none of them is a leading zero glyph.

## 6. Checksum

### 6.1 Requirements

The checksum must:

- Be deterministic.
- Include the profile ID or a profile-specific domain value.
- Include every body symbol in order.
- Be simple enough to implement consistently.
- Use only the configured safe checksum alphabet.

Detection strength is a property of the checksum modulus, not the profile as such. When the modulus `M` exceeds the maximum symbol-value delta (`bodyAlphabetSize - 1`) and the multiplier is coprime with `M`, all single-symbol substitutions are provably detected; adjacent transpositions are provably detected when `gcd(36, M)` times every possible value difference stays below `M`. When `M` is smaller, some structured errors evade detection and the measured rate must be published instead of claimed. The three checksummed frozen tiers ship two checksum symbols each (section 17), so their moduli are `S^2` (between 441 and 576): all three provably detect every single-symbol substitution, and Medium and Heavy detect every adjacent transposition as well. Section 6.3 has the per-tier numbers.

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

The three checksummed frozen tiers ship two checksum symbols, so each modulus is the square of its checksum alphabet size (section 17).

- `baseh-minimum-v1`: no checksum. Typo detection is impossible; every displayed string is a valid code.
- `baseh-light-v1` (`M = 576`, body values 0..30): a substitution needs a delta that is a multiple of 576 to evade detection, which no 31-symbol alphabet can produce, so single-substitution detection is provably total. A random invalid body matches with about a `1/576` chance. Adjacent transpositions evade detection when the swapped values differ by a multiple of 16, because `gcd(36, 576) = 36` reduces the escape condition to `16 | (a - b)`. This is why Light remains aimed at typed, not spoken, workflows.
- `baseh-medium-v1` (`M = 529`, body values 0..27): substitution detection is provably total and, since `gcd(36, 529) = 1`, an adjacent transposition escapes only for a value difference that is a multiple of 529, which cannot occur in a 28-symbol alphabet. Both structured error classes are provably detected; the random match rate is about `1/529`.
- `baseh-heavy-v1` (`M = 441`, body values 0..25): substitution detection is provably total and, since the escape condition reduces to `49 | (a - b)`, adjacent transposition detection is total as well. The random match rate is about `1/441`.

Every checksummed frozen tier is now suitable for unattended self-service lookup, which is exactly why version 2 ships two checksum symbols on all three. Multi-symbol edits (for example two wrong symbols in one code) are still only caught at the random-match rate.

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

   In expandable mode the permutation domain is one generation's value
   range (section 19.4), and the total code length `L` of that generation
   is mixed into the key derivation. The expandable-mode `message_i` is
   exactly this byte sequence:

   ```text
   "BASEH-FEISTEL-V1" (14 ASCII bytes)
   0x00
   ASCII(profileId)
   0x00
   ASCII decimal representation of L, most significant digit first,
       no leading zeros
   0x00
   i as one byte (round number, 0-based)
   right as an unsigned big-endian integer in ceil(wr(i) / 8) bytes
       (zero bytes when wr(i) = 0)
   ```

   The version string stays `"BASEH-FEISTEL-V1"`: expandable mode is a new
   mode, not a change to the fixed-mode construction, and fixed-mode
   messages remain byte-for-byte unchanged.

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
- Do not put keys in frontend code. (The frozen published key of section 7.5 is the deliberate exception; it is not a secret.)

### 7.5 The frozen published key

The four frozen tiers (section 17) all permute with a published key so the zero-argument profile helpers work without key provisioning:

```text
FROZEN_KEY_BYTES = ASCII("baseh-frozen-key-v1")
keyId            = "frozen"
rounds           = 8
```

This key is public on purpose and is embedded in every implementation. It provides obscurity only: codes do not follow the database sequence, but anyone can invert the mapping, so it adds zero secrecy. Applications that need a private mapping use the keyed `-p` tier variants with their own key material and manage that key per section 7.4. The frozen key must never change; doing so would re-map every issued code.

### 7.6 Round function

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
- Drop replacements that are not canonical body symbols before generating: a candidate the alphabet cannot contain could never validate, and checksumming it must not surface as `INVALID_CHARACTER`.
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

In expandable mode the separator applies only at or above `separatorMinLength`: when the presented or emitted total length `L` is below `separatorMinLength`, the code renders bare and the decoder accepts (and expects) no separators, regardless of the configured `separator`. At or above the threshold the configured separator applies and the balanced grouping rule of section 19.5 splits that length.

The web tools pick `grouping` from the total displayed length (`bodyLength + checksumLength`) with one fixed rule, so a configuration transferred between the tools and a frozen profile keeps the same visual rhythm: no delimiter at 3 or fewer characters; groups of 2 at 4; groups of 3 up to 6; groups of 4 up to 8; groups of 5 beyond that, with any leftover short group trailing. Every frozen tier uses this rule directly: Minimum at 6 characters is `[3, 3]` and Light, Medium and Heavy at 8 characters are `[4, 4]`, all hyphen-delimited (section 17).

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

Fixed mode only: returns `bodyAlphabetSize^bodyLength`. Expandable profiles
have no single capacity; use the per-generation formulas of section 19.1.

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

Four frozen tiers ship with the library. Each is the full alphanumeric set with cumulative visual and spoken strips applied exactly as the web tools derive them; all four run the default profanity blocklist (section 18) and keep their typed aliases. `baseh-medium-v1` is the documented default.

Version 2 shapes: all four tiers permute with the frozen published key (section 7.5) and carry a hyphen at the midpoint; Light, Medium and Heavy carry two checksum symbols, Minimum carries none. Capacities are unchanged from version 1 because body length stays 6 everywhere. Codes issued under the version 1 shapes do not decode under these profiles.

| Tier | Symbols | Checksum | Delimiter | Permutation | Capacity | Use for |
|---|---|---|---|---|---|---|
| `baseh-minimum-v1` | 36 | none | hyphen, `[3, 3]` | frozen key | 2,176,782,336 | Typed contexts where typos are caught downstream |
| `baseh-light-v1` | 31 | 2 | hyphen, `[4, 4]` | frozen key | 887,503,681 | Typed workflows with light safety |
| `baseh-medium-v1` | 28 | 2 | hyphen, `[4, 4]` | frozen key | 481,890,304 | General use; the default |
| `baseh-heavy-v1` | 26 | 2 | hyphen, `[4, 4]` | frozen key | 308,915,776 | Spoken-first workflows |

`baseh-medium-v1`, the default:

```json
{
  "profileId": "baseh-medium-v1",
  "bodyAlphabet": "0123456789ACDEFGHJKMPQRUVXYZ",
  "bodyLength": 6,
  "checksumAlphabet": "234679ACDEFGHJKMPQRUVXY",
  "checksumLength": 2,
  "caseSensitive": false,
  "separator": "-",
  "grouping": [4, 4],
  "aliases": {
    "O": "0",
    "I": "1",
    "L": "1",
    "T": "P",
    "N": "M",
    "W": "V"
  },
  "permutation": {
    "enabled": true,
    "algorithm": "feistel-v1",
    "keyId": "frozen",
    "keyBytesHex": "62617365682d66726f7a656e2d6b65792d7631",
    "rounds": 8
  },
  "profanity": {
    "mode": "blocklist"
  }
}
```

`baseh-minimum-v1`: `bodyAlphabet` is the full `"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"`, `checksumAlphabet` is empty, `checksumLength` is 0, `separator` is `"-"`, `grouping` is `[3, 3]` and `aliases` is empty, because every alphanumeric symbol is canonical. Permutation is the same frozen key as the other tiers.

`baseh-light-v1`: `bodyAlphabet` `"0123456789ABCEFGHJKMNPQRSUVWXYZ"`, `checksumAlphabet` `"234679ACEFGHJKMNPQRUVWXY"`, `checksumLength` 2, `separator` `"-"`, `grouping` `[4, 4]`, aliases adding `"D": "B"` and `"T": "P"` to the `O`/`I`/`L` set.

`baseh-heavy-v1`: `bodyAlphabet` `"0123456789ABCEFHJKMPQRVXYZ"`, `checksumAlphabet` `"234679ACEFHJKMPQRUVXY"`, `checksumLength` 2, `separator` `"-"`, `grouping` `[4, 4]`, aliases adding `"D": "B"`, `"T": "P"`, `"N": "M"`, `"W": "V"`, `"S": "F"` and `"G": "C"` to the `O`/`I`/`L` set.

Each tier also ships a keyed variant whose `profileId` gains a `-p` segment (`baseh-minimum-p-v1` through `baseh-heavy-p-v1`): identical to the plain tier but with Feistel-v1 permutation keyed by caller-supplied key material (section 7) instead of the frozen published key. Application-specific permutation keys are never part of a frozen profile and each application assigns its own `keyId` and key material. Profile helpers return a freshly built, mutable profile object on every call, so an application can load a default and then modify it (longer body, custom separator, no profanity blocklist) without mutating the frozen definition from which it started. The shared `vectors.json` pins every tier's checksum, formatting and frozen-key Feistel behaviour; implementations must match it before release.

### 17.1 The expandable tier

One expandable-mode tier ships frozen, `baseh-expandable-v1`, and is the recommended starting point for new namespaces. Its codes are four characters while the namespace is small and gain one symbol automatically as issuance climbs (section 19); every shorter code keeps decoding forever. All four fixed tiers above are `mode: "fixed"` and are byte-for-byte unaffected by this profile.

```json
{
  "profileId": "baseh-expandable-v1",
  "mode": "expandable",
  "bodyAlphabet": "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ",
  "minLength": 4,
  "checksumAlphabet": "0123456789ABCDEFGHIJKLMNPQRSTUVWXYZ",
  "checksumLength": 2,
  "caseSensitive": false,
  "separator": "-",
  "separatorMinLength": 6,
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
    "enabled": true,
    "algorithm": "feistel-v1",
    "keyId": "frozen",
    "keyBytesHex": "62617365682d66726f7a656e2d6b65792d7631",
    "rounds": 8
  },
  "profanity": {
    "mode": "blocklist"
  }
}
```

The body alphabet is the full alphanumeric set minus `0` and `O` (34 symbols; the zero ban of section 19.2). The checksum alphabet is `"0"` followed by the body alphabet in order (35 symbols, section 19.3), giving a checksum modulus of `35^2 = 1225`. Since `1225` exceeds the maximum body-symbol value delta of 33 and `gcd(37, 1225) = 1`, single-substitution detection is provably total; since `gcd(36, 1225) = 1`, adjacent-transposition detection is provably total as well, at every generation (section 6.3). The alias set matches `baseh-medium-v1`; note that `O -> 0` can only ever resolve in a checksum position, because `0` and `O` can never appear in a body (section 19.2). Permutation is the frozen published key of section 7.5, applied per generation with the length mixed into the key derivation (section 19.4). The hyphen appears from six characters up: lengths 4 and 5 render bare, and at or above six the balanced grouping rule of section 19.5 splits the length — 6 renders `XXX-XXX`, 7 `XXXX-XXX`, 8 `XXXX-XXXX`, 9 `XXXXX-XXXX`, 10 `XXXXX-XXXXX`, and so on per the pinned table.

Generation capacities (body alphabet 34, checksum length 2, so generation `L` holds `34^(L-2)` ids; section 19.1):

| Total length | Body symbols | Generation capacity | Cumulative ids |
|---:|---:|---:|---:|
| 4 | 2 | 1,156 | 1,156 |
| 5 | 3 | 39,304 | 40,460 |
| 6 | 4 | 1,336,336 | 1,376,796 |
| 7 | 5 | 45,435,424 | 46,812,220 |
| 8 | 6 | 1,544,804,416 | 1,591,616,636 |

`baseh-expandable-p-v1` is the keyed variant, mirroring the fixed `-p` tiers: identical to `baseh-expandable-v1` but with Feistel-v1 permutation keyed by caller-supplied key material (section 7) instead of the frozen published key, with the caller assigning its own `keyId`.

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

## 19. Expandable mode

Expandable mode gives a profile variable-length codes driven by id
magnitude: codes are short while the namespace is small and gain one symbol
automatically as the id counter climbs. Nothing is ever re-issued, re-mapped
or reclaimed, and every code ever issued keeps decoding under the same
profile. All rules in this section are mode-conditional; fixed-mode
behaviour is unchanged everywhere.

### 19.1 Generations and capacity

Let `A` be the body alphabet size, `K` the checksum length and `min` the
profile `minLength`. Each total code length `L >= min` is a **generation**
with body length `L - K` and generation capacity:

```text
generationCapacity(L) = A^(L - K)
```

Generations tile the non-negative integers contiguously in ascending length.
Generation `L` covers exactly the ids:

```text
generationBase(L) <= id < generationBase(L + 1)

generationBase(L) = sum of A^(k - K) for k from min through L - 1
                  = (A^(L - K) - A^(min - K)) / (A - 1)
```

with `generationBase(min) = 0`. The total length is bounded by 32, matching
the fixed-mode body-length ceiling: an id that would require `L > 32` fails
`OUT_OF_RANGE`. There is no other upper bound on the id; a growing sequence
never runs out, it simply gets longer.

Worked example for `baseh-expandable-v1` (`A = 34`, `K = 2`, `min = 4`):

```text
generationBase(4) = 0
generationBase(5) = 34^2                    = 1,156
generationBase(6) = 34^2 + 34^3             = 40,460
generationBase(7) = ... + 34^4              = 1,376,796
```

So id `1,155` is the last four-character code and id `1,156` is the first
five-character code.

### 19.2 The zero ban and the no-padding rule

In expandable mode the body alphabet must not contain `0` or `O`. Profile
preparation removes both symbols silently — including from a custom
alphabet — before any other validation, exactly as `no-vowels` stripping
does (section 18.1), and validation then asserts their absence like any
other profile invariant (section 2.2).

The consequence is load-bearing: the body zero symbol carries value 0, so
with `0` removed from the body alphabet no canonical code can begin with a
zero-value symbol. No human ever sees a leading zero glyph to drop, so
expandable mode has **no left-padding anywhere**: the encoder never pads,
and the fixed-mode stripped-leading-zeros leniency of section 3.4 does not
apply. Presented input shorter than `minLength` fails `INVALID_LENGTH`.

The ban applies to body positions only. Because the checksum alphabet does
contain `0` (section 19.3), a presented `0` passes the union-membership
check of normalization step 6 (section 3.1) and then fails at the body
split with `INVALID_CHARACTER` whenever it lands in a body position — the
same path fixed mode already uses for a body-alphabet violation (section
9). A typed `O` is aliased to `0` during normalization (the `O -> 0` alias
still applies) and then follows exactly the same path: it fails
`INVALID_CHARACTER` in a body position and resolves correctly in a checksum
position.

### 19.3 Checksum alphabet

In expandable mode the checksum alphabet is the body alphabet plus `0`,
ordered as `"0"` followed by the body alphabet in order. For the default
34-symbol body this is 35 symbols. The checksum algorithm itself is
unchanged (section 6.2): same version 1 rolling polynomial, same `profileId`
domain separation, same modulus rule `S^K` — only the alphabet, and
therefore `S`, differs per profile as usual. The `O -> 0` alias applies to
checksum positions. The checksum does not mix in the code length; domain
separation between generations comes from the length-selects-generation
decode flow (section 19.7): a body of the wrong length splits differently
and the checksum fails at the random-match rate.

### 19.4 Per-generation permutation

Permutation stays on in expandable mode. The Feistel domain is each
generation's own value range:

```text
domain(L) = A^(L - K)     values 0 through A^(L - K) - 1
```

where `A` is the body alphabet size, `K` the checksum length and `L` the
total length of the generation. The value permuted is the id's offset
within the generation (`id - generationBase(L)`), never the raw id. The
total length `L` is mixed into the key derivation alongside the `profileId`
via the expandable-mode message encoding of section 7.3, so each generation
is an independent shuffle. The algorithm, round function, cycle walking and
iteration ceiling are otherwise unchanged, and fixed-mode Feistel is
byte-for-byte unchanged.

### 19.5 Separators and grouping

`separatorMinLength` is an integer of at least 0 (default 0, meaning the
separator always applies, as fixed mode behaves today). When the total
length `L` is below `separatorMinLength`, the separator is empty and the
grouping is empty for that length, regardless of the configured
`separator`: the code renders bare and the decoder expects no
separators. At or above the threshold, the configured separator applies and
the balanced grouping rule below splits that length.

In expandable mode the fixed-mode rule "group sizes sum to `bodyLength +
checksumLength`" cannot hold for every length, and the split must be a pure
function of the total length so encoder and decoder agree without
configuration. `grouping` is therefore meaningless in expandable mode and
must be empty (section 2.2). Instead the **balanced grouping rule**
applies: for a total length `L >= separatorMinLength` with a non-empty
separator, the number of groups is

```text
g = max(2, ceil(L / 5))
```

and group sizes differ by at most one, with the larger groups to the left:

```text
base = floor(L / g)
rem  = L mod g
sizes = [base + 1] repeated rem times, then [base] repeated (g - rem) times
```

For `L` below 2 the split is trivial (a single group); in practice
`separatorMinLength` is at least 2 whenever a separator is in effect.

Pinned shapes for total length 4 through 16:

```text
L = 4    XX-XX
L = 5    XXX-XX
L = 6    XXX-XXX
L = 7    XXXX-XXX
L = 8    XXXX-XXXX
L = 9    XXXXX-XXXX
L = 10   XXXXX-XXXXX
L = 11   XXXX-XXXX-XXX
L = 12   XXXX-XXXX-XXXX
L = 13   XXXXX-XXXX-XXXX
L = 14   XXXXX-XXXXX-XXXX
L = 15   XXXXX-XXXXX-XXXXX
L = 16   XXXX-XXXX-XXXX-XXXX
```

Balanced groups keep the visual weight centered as codes grow, and because
the split depends only on `L`, every implementation derives it identically
with nothing to configure. Note that the frozen fixed tiers' `[3, 3]` and
`[4, 4]` happen to satisfy the balanced rule at their single length, but
fixed mode imposes no such rule — its `grouping` stays user-configured with
the sum validation of section 2.2.

### 19.6 Encode flow

```text
function encodeExpandable(id, profile):
    validateProfile(profile)
    A = len(profile.bodyAlphabet)
    K = profile.checksumLength

    if id < 0:
        error OUT_OF_RANGE

    L = smallest total length >= profile.minLength
        with id < generationBase(L + 1)        # section 19.1

    if L > 32:
        error OUT_OF_RANGE

    value = id - generationBase(L)             # offset within generation
    domain = pow(A, L - K)

    if profile.permutation.enabled:
        value = permute(value, domain, profile.permutation, L)   # 19.4

    body = encodeBaseN(value, profile.bodyAlphabet, L - K)
    checksum = calculateChecksum(profile, body)
    raw = body + checksum

    if profile.profanity.mode == "blocklist":
        if any effective blocklist word is a case-insensitive
           substring of raw:                   # section 18
            error BLOCKED_CODE

    if L < profile.separatorMinLength:
        return raw

    return format(raw, expandableGrouping(L), profile.separator)
```

### 19.7 Decode flow

Decode follows section 9 with the fixed-mode steps replaced as follows:

1. Normalize per section 3.1, without the re-pad step.
2. `L = ` the normalized unformatted length. If `L < minLength`, error
   `INVALID_LENGTH`. If `L > 32`, error `INVALID_LENGTH`.
3. Split `body = raw[0 : L - K]` and `suppliedChecksum = raw[L - K :]`.
4. If the body contains a symbol outside the body alphabet, error
   `INVALID_CHARACTER`. This is where a presented `0` or `O` in a body
   position fails (section 19.2).
5. Checksum validation and correction proceed exactly as section 9, with
   one restriction: correction candidates must stay within the presented
   length. `AMBIGUOUS_INPUT` behaviour is unchanged, but candidate
   generation never adds or removes symbols (section 10 already forbids
   insertions and deletions), so no cross-generation correction is
   possible.
6. `offset = decodeBaseN(body, profile.bodyAlphabet)`; if permutation is
   enabled, `offset = inversePermute(offset, A^(L - K), profile.permutation, L)`.
   Then `id = generationBase(L) + offset`.
7. `canonicalCode = encode(id, profile)`. Because the permutation keeps an
   offset inside its generation, the canonical code always has the
   presented length `L`, and `corrected` is computed as in section 9.

A code presented at the wrong length for its id — for example a code from
generation 5 with a symbol appended — decodes as a different generation,
splits body and checksum differently and fails `INVALID_CHECKSUM` at the
random-match rate; it can never alias a valid shorter code.

### 19.8 Error semantics

New and clarified cases for expandable mode:

- Normalized input shorter than `minLength`: `INVALID_LENGTH`. There is no
  stripped-zero rescue (section 19.2).
- Normalized input longer than 32 symbols: `INVALID_LENGTH`.
- `0` or `O` (after the `O -> 0` alias) in a body position:
  `INVALID_CHARACTER`. In a checksum position both are accepted, with `O`
  resolving to `0`.
- Encode of a negative id, or of an id requiring `L > 32`: `OUT_OF_RANGE`.
- Wrong-length presentation of an otherwise valid code:
  `INVALID_CHECKSUM` (section 19.7).
- `AMBIGUOUS_INPUT` correction is unchanged but never crosses generations:
  candidates keep the presented length.

### 19.9 Mode declaration

Expandable mode changes encode and decode behaviour — length model,
alphabet preparation, padding, permutation domain, formatting — enough that
the mode is part of a profile's identity. A persisted or frozen profile
definition must declare `mode` explicitly once implementations support it,
and a decoder must not guess the mode from the presented input. Profiles
constructed programmatically without a mode are treated as `"fixed"`
(section 2.2).
