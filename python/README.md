# base-human

Python implementation of the HRC (Human Reference Code) codec. Encodes an
internal integer ID as a checksumed, optionally permuted human-readable
reference code. Implements the normative spec in `../spec/IMPLEMENTATION_CODEC.md`
and passes the frozen cross-language vectors in `../vectors/`.

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
from base_human import Hrc, HrcError, hrc32_v1

key = bytes.fromhex("746573742d6f6e6c792d6b65792d6d6174657269616c2d30303031")
hrc = Hrc(hrc32_v1(key, "my-app-01"))

code = hrc.encode(123456789)
print(code)                       # VCS-PQ2-G

result = hrc.decode("vcs-pq2-g")  # case-insensitive, separators optional
print(result.id)                  # 123456789
print(result.canonical_code)      # VCS-PQ2-G
print(result.corrected)           # False (input differed only in case)

# Assisted correction over spoken-confusion pairs (B/D, P/T, ...):
fixed = hrc.decode(
    "VCS-PQ2-G",
    try_correction=True,
    confusion_profile="light",
)

# Non-throwing validation for user input:
check = hrc.validate("000-000-0")
print(check)                      # {"valid": False, "reason": "INVALID_CHECKSUM"}

print(hrc.capacity())             # 1073741824
```

Errors raise `HrcError` with a `.code` attribute, one of:
`INVALID_PROFILE`, `OUT_OF_RANGE`, `PERMUTATION_FAILURE`, `INVALID_LENGTH`,
`INVALID_CHARACTER`, `INVALID_CHECKSUM`, `AMBIGUOUS_INPUT`,
`TOO_MANY_CANDIDATES`.

## Tests

```bash
cd python
PYTHONPATH=src python3 -m unittest discover -s tests -v
```
