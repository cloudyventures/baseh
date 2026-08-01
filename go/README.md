# baseh (Go)

Go port of the baseH reference codec. Zero dependencies,
stdlib only. Conforms to `spec/IMPLEMENTATION_CODEC.md` and the frozen
cross-language vectors in `vectors/`.

## Install

```sh
go get github.com/cloudyventures/baseh/go/v2
```

## Expandable mode

Profiles carry a `Mode` field: `"expandable"` or `"fixed"`. All the frozen
tiers below are `Mode: "fixed"` and behave exactly as before. The new
frozen tier `baseh-expandable-v1` (helper `ExpandableV1()`) is the
recommended starting point for new users.

Expandable properties:

- Codes start short and grow automatically: minimum length 4 characters
  (profile field `MinLength`, default 4). As the id sequence climbs past
  each length's capacity, codes simply become one character longer —
  transparently, with no migration or re-issue. Old shorter codes keep
  decoding forever; the code's length selects the generation at decode.
- The default expandable body alphabet is the 27 symbols left after the
  medium visual and spoken safety strips and the `0`/`O` zero ban, so an
  issued code never emits a visual or spoken confusable. A custom alphabet
  containing `0`/`O` has those symbols silently removed during profile
  preparation. This composes unchanged with the existing visual/spoken
  safety levels, profanity modes and blocklists.
- The checksum alphabet is the body alphabet plus `0` (28 symbols for the
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
  profile field `SeparatorMinLength` (the shipped tier uses 6, i.e. no
  hyphen until codes are 6+ characters). Below the threshold there is no
  separator and no grouping.

The security posture is unchanged: a code is a reference alias, never an
authorization token. Expandable codes in the smallest generations are a
small namespace, so rate-limit public lookups and enforce authorization
after decode.

## Frozen tiers (fixed mode)

The package ships eight frozen-profile helpers covering four tiers. All
are `Mode: "fixed"` — constant-width codes for fixed-width needs — and
share a 6-symbol body, a hyphen delimiter at the midpoint, case-insensitive
decode and the default profanity blocklist:

| Tier    | Symbols | Checksums | Format    | Capacity      |
|---------|---------|-----------|-----------|---------------|
| Minimum | 36      | none      | XXX-XXX   | 2,176,782,336 |
| Light   | 31      | 2         | XXXX-XXXX | 887,503,681   |
| Medium  | 28      | 2         | XXXX-XXXX | 481,890,304   |
| Heavy   | 26      | 2         | XXXX-XXXX | 308,915,776   |

`MinimumV1()`, `LightV1()`, `MediumV1()` and
`HeavyV1()` take no arguments. Medium is the default fixed tier
(expandable is the recommended default overall).

Every tier permutes with the frozen published key (`FrozenKeyBytes()`). The
key is public by design: it makes issued codes look non-sequential but
offers no secrecy, since anyone can read it in `profiles.go`. Never swap
it on a live namespace; codes only decode with the key they were issued
under.

Every helper returns a freshly-built `Profile` value, so callers can load
a default and modify it (words, separators and so on) before `New`
without affecting other profiles from the same helper.

## Usage

Expandable mode is the recommended default for new users. Codes start
at 4 characters and grow automatically as the id sequence climbs — no
migration, no re-issue, and old shorter codes keep decoding forever:

```go
package main

import (
	"fmt"
	"math/big"

	baseh "github.com/cloudyventures/baseh/go/v2"
)

func main() {
	h, err := baseh.New(baseh.ExpandableV1())
	if err != nil {
		panic(err) // invalid profile: fail at startup
	}

	code, err := h.Encode(big.NewInt(123456789))
	if err != nil {
		panic(err)
	}
	fmt.Println(code) // 4 characters at this namespace size; grows as ids climb

	res, err := h.Decode(code, nil)
	if err != nil {
		panic(err)
	}
	fmt.Println(res.ID) // 123456789
}
```

For constant-width needs, use a fixed-mode tier such as Medium:

```go
package main

import (
	"fmt"
	"math/big"

	baseh "github.com/cloudyventures/baseh/go/v2"
)

func main() {
	h, err := baseh.New(baseh.MediumV1())
	if err != nil {
		panic(err) // invalid profile: fail at startup
	}

	code, err := h.Encode(big.NewInt(123456789))
	if err != nil {
		panic(err)
	}
	fmt.Println(code) // C8XP-8J49

	res, err := h.Decode("c8xp-8j49", &baseh.DecodeOptions{
		AcceptSpaces: true,
	})
	if err != nil {
		panic(err)
	}
	fmt.Println(res.ID)

	// Boolean-only check; never exposes an internal ID on failure.
	if v := h.Validate("00000000", nil); !v.Valid {
		fmt.Println("invalid code:", v.Reason)
	}
}
```

## Permutation variants

Every plain tier already runs the reversible feistel-v1 permutation with
the frozen published key. Each tier also has a `-p` variant that permutes
with caller-supplied key material instead: `MinimumPV1`,
`LightPV1`, `MediumPV1` and `HeavyPV1`, each taking
`keyBytes []byte, keyID string, rounds int`, plus `ExpandablePV1` for
the keyed private-mapping expandable variant (`baseh-expandable-p-v1`,
shipping in the next release). Key bytes are required; an
empty key id defaults to `"default"` and zero rounds to 8. Key material
is application-specific and never part of the frozen profile.

```go
key := []byte("application-secret-key-material")
h, err := baseh.New(baseh.MediumPV1(key, "prod-01", 8))
```

## Errors

Errors are always `*baseh.Error` with a stable `Code` field (one of
`INVALID_PROFILE`, `OUT_OF_RANGE`, `PERMUTATION_FAILURE`, `INVALID_LENGTH`,
`INVALID_CHARACTER`, `INVALID_CHECKSUM`, `AMBIGUOUS_INPUT`,
`TOO_MANY_CANDIDATES` and `BLOCKED_CODE`), retrievable with `errors.As`.

The optional spec-18 `Profanity` field supports mode `no-vowels` (vowels
stripped from both alphabets) and mode `blocklist` (encode fails with
`BLOCKED_CODE` when the raw code contains a blocked substring). The frozen
tiers all run mode `blocklist` with the default list.

## Test

```sh
go test -count=1 ./...
go vet ./...
```

`vectors_test.go` loads the shared conformance vectors from
`../vectors/*.json` and asserts every encode, decode, error, encode-error,
correction and Feistel case.
