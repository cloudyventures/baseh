# @cloudyventures/baseh

TypeScript implementation of the baseH (Human Reference Code) codec. Encodes
integer IDs as fixed-length, checksummed, human-friendly reference codes with
a feistel-v1 permutation on every tier and profanity safety. The normative
spec is `spec/IMPLEMENTATION_CODEC.md` in the
[monorepo](https://github.com/cloudyventures/baseh).

## Install

```sh
npm install @cloudyventures/baseh
```

Zero runtime dependencies. Requires Node 18 or later (native `BigInt`).

## Frozen tiers

Four frozen tiers ship with the package, built from the full alphanumeric set
with cumulative visual and spoken strips. All four encode 6 body symbols,
are case-insensitive, hyphen-delimit at the midpoint, run the default
profanity blocklist and permute with the published frozen key.

| Tier | Helper | Body symbols | Checksum | Format | Capacity |
| ---- | ------ | ------------ | -------- | ------ | -------- |
| Minimum | `basehMinimumV1` | 36 | none | `XXX-XXX` | 2,176,782,336 |
| Light | `basehLightV1` | 31 | 2 | `XXXX-XXXX` | 887,503,681 |
| Medium | `basehMediumV1` | 28 | 2 | `XXXX-XXXX` | 481,890,304 |
| Heavy | `basehHeavyV1` | 26 | 2 | `XXXX-XXXX` | 308,915,776 |

Medium is the default. The frozen key is public by design: it hides sequence,
not records. See the spec, section 7.5.

## Usage

```typescript
import { Baseh, basehMediumV1 } from "@cloudyventures/baseh";

const codec = new Baseh(basehMediumV1());

const code = codec.encode(123456n);        // fixed-width hyphenated code

const result = codec.decode(code);
result.id;                                 // 123456n
result.canonicalCode;                      // canonical form
result.corrected;                          // true when input needed correction

codec.capacity;                            // 481890304n

const check = codec.validate("00000000");
check.valid;                               // false
check.reason;                              // "INVALID_CHECKSUM"

// Spoken-confusion correction
codec.decode("TB14QDFU", { tryCorrection: true, confusionProfile: "light" });
```

IDs are `bigint`, so every capacity and ID operation is exact at any size.

## Permutation

The plain tiers permute with `FROZEN_KEY_BYTES` (the published frozen key).
The `P` variants take a caller-supplied key instead; keep that key in a
secret manager and never change it for a live profile:

```typescript
import { basehMediumPV1 } from "@cloudyventures/baseh";

const codec = new Baseh(
  basehMediumPV1({ keyBytes, keyId: "prod-01" })
);
```

## Errors

All failures raise `BasehError` with a `code` from the spec:
`INVALID_PROFILE`, `OUT_OF_RANGE`, `PERMUTATION_FAILURE`, `INVALID_LENGTH`,
`INVALID_CHARACTER`, `INVALID_CHECKSUM`, `AMBIGUOUS_INPUT`,
`TOO_MANY_CANDIDATES` and `BLOCKED_CODE`. `validate` never raises on user
input.

## License

AGPL-3.0. Commercial licensing available; see
[COMMERCIAL.md](https://github.com/cloudyventures/baseh/blob/main/COMMERCIAL.md).
