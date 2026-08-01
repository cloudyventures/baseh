# basehuman (Go)

Go port of the BaseH (Base Human) reference codec. Zero dependencies,
stdlib only. Conforms to `spec/IMPLEMENTATION_CODEC.md` and the frozen
cross-language vectors in `vectors/`.

## Install

```sh
go get github.com/matellis/baseh/go
```

## Frozen tiers

The package ships eight frozen-profile helpers covering four tiers. All
share a 6-symbol body, case-insensitive decode and the default profanity
blocklist:

| Tier    | Symbols | Checksum | Format   | Capacity      |
|---------|---------|----------|----------|---------------|
| Minimum | 36      | none     | XXX-XXX  | 2,176,782,336 |
| Light   | 31      | 1        | XXXXXXX  | 887,503,681   |
| Medium  | 28      | 1        | XXXXXXX  | 481,890,304   |
| Heavy   | 26      | 1        | XXXXXXX  | 308,915,776   |

`BasehMinimumV1()`, `BasehLightV1()`, `BasehMediumV1()` and
`BasehHeavyV1()` take no arguments. Medium is the default tier.

Every helper returns a freshly-built `Profile` value, so callers can load
a default and modify it (words, separators and so on) before `NewBaseh`
without affecting other profiles from the same helper.

## Usage

```go
package main

import (
	"fmt"
	"math/big"

	basehuman "github.com/matellis/baseh/go"
)

func main() {
	h, err := basehuman.NewBaseh(basehuman.BasehMediumV1())
	if err != nil {
		panic(err) // invalid profile: fail at startup
	}

	code, err := h.Encode(big.NewInt(123456789))
	if err != nil {
		panic(err)
	}
	fmt.Println(code) // 74UYC19

	res, err := h.Decode("74uyc19", &basehuman.DecodeOptions{
		AcceptSpaces: true,
	})
	if err != nil {
		panic(err)
	}
	fmt.Println(res.ID)

	// Boolean-only check; never exposes an internal ID on failure.
	if v := h.Validate("0000000", nil); !v.Valid {
		fmt.Println("invalid code:", v.Reason)
	}
}
```

## Permutation variants

Each tier has a `-p` variant that enables the reversible feistel-v1
permutation: `BasehMinimumPV1`, `BasehLightPV1`, `BasehMediumPV1` and
`BasehHeavyPV1`, each taking `keyBytes []byte, keyID string, rounds int`.
Key bytes are required; an empty key id defaults to `"default"` and zero
rounds to 8. Key material is application-specific and never part of the
frozen profile.

```go
key := []byte("application-secret-key-material")
h, err := basehuman.NewBaseh(basehuman.BasehMediumPV1(key, "prod-01", 8))
```

## Errors

Errors are always `*basehuman.Error` with a stable `Code` field (one of
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
