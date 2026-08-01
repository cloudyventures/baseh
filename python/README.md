# baseh

Python implementation of the baseH codec. Encodes an internal integer ID as
a checksummed, optionally permuted human-readable reference code. Implements
the normative spec in `../spec/IMPLEMENTATION_CODEC.md` and passes the
frozen cross-language vectors in `../vectors/`.

Zero runtime dependencies. HMAC-SHA-256 comes from the standard library.

## Install

```bash
pip install ./python
```

Or run in place without installing:

```bash
PYTHONPATH=python/src python3 -c "import baseh"
```

## Usage

Expandable mode is the recommended default for new users. Codes start
at 4 characters and grow automatically as the id sequence climbs — no
migration, no re-issue, and old shorter codes keep decoding forever:

```python
from baseh import Baseh, BasehError, baseh_expandable_v1

codec = Baseh(baseh_expandable_v1())

code = codec.encode(123456789)
print(code)                       # 4 characters at this namespace size; grows as ids climb

result = codec.decode(code.lower())  # case-insensitive
print(result.id)                  # 123456789
```

For constant-width needs, use a fixed-mode tier such as Medium:

```python
from baseh import Baseh, BasehError, baseh_medium_v1

codec = Baseh(baseh_medium_v1())

code = codec.encode(123456789)
print(code)                       # "C8XP-8J49": fixed-length, checksummed code

result = codec.decode(code.lower())  # case-insensitive
print(result.id)                  # 123456789
print(result.canonical_code)      # "C8XP-8J49"
print(result.corrected)           # False (input differed only in case)

# Assisted correction over spoken-confusion pairs (B/D, P/T, C/G, ...):
fixed = codec.decode(
    "GC8G-AZ2V",
    try_correction=True,
    confusion_profile="heavy",
)
print(fixed.corrected)            # True
print(fixed.canonical_code)       # "CC8G-AZ2V"

# Non-throwing validation for user input:
check = codec.validate("00000000")
print(check)                      # {"valid": False, "reason": "INVALID_CHECKSUM"}

print(codec.capacity())           # 481890304
```

Errors raise `BasehError` with a `.code` attribute, one of:
`INVALID_PROFILE`, `OUT_OF_RANGE`, `PERMUTATION_FAILURE`, `INVALID_LENGTH`,
`INVALID_CHARACTER`, `INVALID_CHECKSUM`, `AMBIGUOUS_INPUT`,
`TOO_MANY_CANDIDATES`, `BLOCKED_CODE`.

## Expandable mode

Profiles carry a `mode` field: `"expandable"` or `"fixed"`. All the frozen
tiers below are `mode: "fixed"` and behave exactly as before. The new
frozen tier `baseh-expandable-v1` (helper `baseh_expandable_v1()`) is the
recommended starting point for new users.

Expandable properties:

- Codes start short and grow automatically: minimum length 4 characters
  (profile field `minLength`, default 4). As the id sequence climbs past
  each length's capacity, codes simply become one character longer —
  transparently, with no migration or re-issue. Old shorter codes keep
  decoding forever; the code's length selects the generation at decode.
- The body alphabet never contains `0` or `O` — the default expandable
  alphabet is the 34 remaining alphanumeric symbols. A custom alphabet
  containing `0`/`O` has those symbols silently removed during profile
  preparation. This composes unchanged with the existing visual/spoken
  safety levels, profanity modes and blocklists.
- The checksum alphabet is the body alphabet plus `0` (35 symbols for the
  default). The existing input alias `O -> 0` remains, so a typed or
  misread `O` in a checksum position resolves to `0`.
- There is no left-padding in expandable mode (fixed mode keeps its
  documented left-pad behaviour). A `0` or `O` in a body position of
  presented input is simply an invalid character.
- Permutation stays ON: the Feistel permutation is applied per generation
  (per code length), with the length mixed into the key derivation
  alongside the profile id. Codes within each length look random even
  though issuance is a sequential counter. Same caveat as today:
  presentation only, not encryption.
- Separators/grouping only appear once codes reach a threshold length:
  profile field `separatorMinLength` (the shipped tier uses 6, i.e. no
  hyphen until codes are 6+ characters). Below the threshold there is no
  separator and no grouping.

The security posture is unchanged: a code is a reference alias, never an
authorization token. Expandable codes in the smallest generations are a
small namespace, so rate-limit public lookups and enforce authorization
after decode.

## Frozen tiers (fixed mode)

Four frozen profiles, each 6 body symbols and case-insensitive, built from
the full alphanumeric set with cumulative visual and spoken strips. All are
`mode: "fixed"` — constant-width codes for fixed-width needs:

| Tier | Helper | Symbols | Checksums | Shape | Capacity |
|------|--------|---------|-----------|-------|----------|
| Minimum | `baseh_minimum_v1()` | 36 | none | `XXX-XXX` | 2,176,782,336 |
| Light | `baseh_light_v1()` | 31 | 2 | `XXXX-XXXX` | 887,503,681 |
| Medium | `baseh_medium_v1()` | 28 | 2 | `XXXX-XXXX` | 481,890,304 |
| Heavy | `baseh_heavy_v1()` | 26 | 2 | `XXXX-XXXX` | 308,915,776 |

Medium is the default fixed tier (expandable is the recommended default
overall). All four keep the typed O/I/L aliases where possible, use a
hyphen delimiter at the midpoint and run the default profanity blocklist.

Every plain tier permutes with the frozen published key, exported as
`FROZEN_KEY_BYTES` (the ASCII bytes of `"baseh-frozen-key-v1"`, 8
feistel-v1 rounds, key id `"frozen"`). The key is public by design: it
makes issued codes look non-sequential but offers no secrecy, since anyone
can read it in the source. Never swap it on a live namespace; codes only
decode with the key they were issued under.

Each helper returns a freshly-built mutable profile dict on every call, so
callers can load a default and modify it:

```python
profile = baseh_medium_v1()
profile["bodyLength"] = 7
profile["grouping"] = [4, 5]  # groups must sum to bodyLength + checksumLength
codec = Baseh(profile)
```

### Permuted variants

The `_p` variants are identical to their tier but permute with
caller-supplied feistel-v1 key material instead of the frozen key:

```python
from baseh import Baseh, baseh_medium_p_v1

key = bytes.fromhex("746573742d6f6e6c792d6b65792d6d6174657269616c2d30303031")
codec = Baseh(baseh_medium_p_v1(key, key_id="my-app-01"))  # rounds defaults to 8
```

Available as `baseh_minimum_p_v1`, `baseh_light_p_v1`, `baseh_medium_p_v1`
and `baseh_heavy_p_v1`, plus `baseh_expandable_p_v1` for the keyed
private-mapping expandable variant (`baseh-expandable-p-v1`).

## Profanity safety (spec 18)

All frozen tiers run the default blocklist. Profiles accept a `profanity`
field to change that:

```python
# Block specific words (substrings of the raw code) at encode time:
profile = baseh_medium_v1()
profile["profanity"] = {"mode": "blocklist", "extraWords": ["QQQQ"]}
codec = Baseh(profile)
# codec.encode(id) raises BasehError(code="BLOCKED_CODE") on a match.

# Or remove vowels from both alphabets entirely:
profile["profanity"] = {"mode": "no-vowels"}
```

## Tests

```bash
cd python
PYTHONPATH=src python3 -m unittest discover -s tests -v
```
