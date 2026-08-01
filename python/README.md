# base-human

Python implementation of the BaseH codec. Encodes an internal integer ID as
a checksumed, optionally permuted human-readable reference code. Implements
the normative spec in `../spec/IMPLEMENTATION_CODEC.md` and passes the
frozen cross-language vectors in `../vectors/`.

Zero runtime dependencies. HMAC-SHA-256 comes from the standard library.

## Install

```bash
pip install ./python
```

Or run in place without installing:

```bash
PYTHONPATH=python/src python3 -c "import base_human"
```

## Usage

```python
from base_human import Baseh, BasehError, baseh32_v1

key = bytes.fromhex("746573742d6f6e6c792d6b65792d6d6174657269616c2d30303031")
codec = Baseh(baseh32_v1(key, "my-app-01"))

code = codec.encode(123456789)
print(code)                       # fixed-length, checksummed code

result = codec.decode(code.lower())  # case-insensitive
print(result.id)                  # 123456789
print(result.canonical_code)      # canonical rendering
print(result.corrected)           # False (input differed only in case)

# Assisted correction over spoken-confusion pairs (B/D, P/T, ...):
fixed = codec.decode(
    code,
    try_correction=True,
    confusion_profile="light",
)

# Non-throwing validation for user input:
check = codec.validate("0000000")
print(check)                      # {"valid": False, "reason": "INVALID_CHECKSUM"}

print(codec.capacity())           # 1073741824
```

Errors raise `BasehError` with a `.code` attribute, one of:
`INVALID_PROFILE`, `OUT_OF_RANGE`, `PERMUTATION_FAILURE`, `INVALID_LENGTH`,
`INVALID_CHARACTER`, `INVALID_CHECKSUM`, `AMBIGUOUS_INPUT`,
`TOO_MANY_CANDIDATES`, `BLOCKED_CODE`.

## Profanity safety (spec 18)

Profiles accept an optional `profanity` field:

```python
# Block specific words (substrings of the raw code) at encode time:
profile = baseh32_v1(key, "my-app-01")
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
