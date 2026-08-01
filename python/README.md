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

## Frozen tiers

Four frozen profiles, each 6 body symbols and case-insensitive, built from
the full alphanumeric set with cumulative visual and spoken strips:

| Tier | Helper | Symbols | Checksums | Shape | Capacity |
|------|--------|---------|-----------|-------|----------|
| Minimum | `baseh_minimum_v1()` | 36 | none | `XXX-XXX` | 2,176,782,336 |
| Light | `baseh_light_v1()` | 31 | 2 | `XXXX-XXXX` | 887,503,681 |
| Medium | `baseh_medium_v1()` | 28 | 2 | `XXXX-XXXX` | 481,890,304 |
| Heavy | `baseh_heavy_v1()` | 26 | 2 | `XXXX-XXXX` | 308,915,776 |

Medium is the default. All four keep the typed O/I/L aliases where
possible, use a hyphen delimiter at the midpoint and run the default
profanity blocklist.

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
and `baseh_heavy_p_v1`.

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
