# @cloudyventures/baseh

TypeScript implementation of the baseH (Human Reference Code) codec. Encodes
integer IDs as checksummed, human-friendly reference codes — short codes that
grow automatically in expandable mode (recommended), or fixed-length codes on
the classic tiers — with a feistel-v1 permutation on every tier and profanity
safety. The normative spec is `spec/IMPLEMENTATION_CODEC.md` in the
[monorepo](https://github.com/cloudyventures/baseh).

## Install

```sh
npm install @cloudyventures/baseh
```

One runtime dependency (`@noble/hashes`, auditable and dependency-free itself). Requires Node 18 or later (native `BigInt`).

## Expandable mode (recommended)

Every profile carries a `mode` field: `"expandable"` or `"fixed"`. Expandable
is the recommended default for new users: codes start short (minimum 4
characters, profile field `minLength`) and grow automatically as the ID
sequence climbs past each length's capacity — transparently, with no
migration and no re-issue. Shorter codes already issued keep decoding
forever; the code's length selects the generation on decode.

The recommended starting tier is `baseh-expandable-v1`:

```typescript
import { Baseh, basehExpandableV1 } from "@cloudyventures/baseh";

const codec = new Baseh(basehExpandableV1());

const code = codec.encode(123456n); // short code; grows as ids climb

const result = codec.decode(code);
result.id;                          // 123456n
```

Expandable mode differs from the fixed tiers as follows:

- The default body alphabet is the 27 symbols left after the medium visual
  and spoken safety strips and the `0`/`O` zero ban, so an issued code
  never emits a visual or spoken confusable. A custom alphabet that includes
  `0`/`O` has those symbols silently removed during profile preparation.
- The checksum alphabet is the body alphabet plus `0` (28 symbols by
  default). The `O -> 0` input alias remains, so a misread `O` in a checksum
  position resolves to `0`; a `0` or `O` in a body position is simply an
  invalid character.
- The short checksum is on by default (codec spec 22): one checksum symbol
  through 5 characters, two beyond; generation 4 holds 19,683 ids (3 body +
  1 checksum) instead of 729. Configure with `shortChecksumLength` and
  `shortChecksumUntil`; `shortChecksumUntil: 0` turns it off.
- There is no left-padding; codes use exactly the length of the current
  generation.
- The Feistel permutation stays on, applied per generation with the code
  length mixed into the key derivation alongside the profile id. Codes within
  each length look random even though issuance is a sequential counter.
  Presentation only, not encryption — same caveat as the fixed tiers.
- Separators only appear once codes reach `separatorMinLength` characters
  (6 in the shipped tier). Below that threshold there is no separator and no
  grouping. Above it the split is the balanced rule of codec spec 19.5 —
  a pure function of the code length (`XXX-XXX` at 6, `XXXX-XXX` at 7,
  `XXXX-XXXX` at 8) — so expandable profiles carry no `grouping` field.
- All other profile options — visual/spoken safety levels, profanity modes,
  blocklists — compose with expandable unchanged.
- The repetition filter is on by default here too: the tier ships
  `maxRepetition: 4`, so a code with a run of four or more identical symbols
  is never issued (any floor of 3 or more is configurable; 0 turns it off).

A keyed private-mapping variant `baseh-expandable-p-v1` mirrors the `-p`
fixed tiers:

```typescript
import { basehExpandablePV1 } from "@cloudyventures/baseh";

const codec = new Baseh(
  basehExpandablePV1({ keyBytes, keyId: "prod-01" })
);
```

Security posture is unchanged: a code is a reference alias, never an
authorization token. The smallest expandable generations are a small
namespace, so rate-limit public lookups and enforce authorization after
decode.

## Frozen tiers (fixed mode)

The classic frozen tiers are all `mode: "fixed"`: constant-width codes for
when you need a stable printed length. Four frozen tiers ship with the
package, built from the full alphanumeric set with cumulative visual and
spoken strips. All four encode 6 body symbols, are case-insensitive,
hyphen-delimit at the midpoint, run the default profanity blocklist, block
runs of four or more identical symbols (the repetition filter,
`maxRepetition: 4` — configurable to any floor of 3 or more, or 0 to turn it
off) and permute with the published frozen key.

| Tier | Helper | Body symbols | Checksum | Format | Capacity |
| ---- | ------ | ------------ | -------- | ------ | -------- |
| Minimum | `basehMinimumV1` | 36 | none | `XXX-XXX` | 2,176,782,336 |
| Light | `basehLightV1` | 31 | 2 | `XXXX-XXXX` | 887,503,681 |
| Medium | `basehMediumV1` | 28 | 2 | `XXXX-XXXX` | 481,890,304 |
| Heavy | `basehHeavyV1` | 26 | 2 | `XXXX-XXXX` | 308,915,776 |

Medium is the default fixed tier. The frozen key is public by design: it
hides sequence, not records. See the spec, section 7.5.

## Usage

```typescript
import { Baseh, basehExpandableV1 } from "@cloudyventures/baseh";

const codec = new Baseh(basehExpandableV1());

const code = codec.encode(123456n);        // short code; grows as ids climb

const result = codec.decode(code);
result.id;                                 // 123456n
result.canonicalCode;                      // canonical form
result.corrected;                          // true when input needed correction

codec.capacity;                            // capacity of the current generation

const check = codec.validate("00000000");
check.valid;                               // false
check.reason;                              // "INVALID_CHECKSUM"

// Spoken-confusion correction
codec.decode("TB14QDFU", { tryCorrection: true, confusionProfile: "light" });
```

Fixed mode works the same way, through a fixed tier helper:

```typescript
import { basehMediumV1 } from "@cloudyventures/baseh";

const fixed = new Baseh(basehMediumV1());
const code = fixed.encode(123456n);        // fixed-width hyphenated code
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

Apache-2.0.
