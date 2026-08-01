# basehuman (Go)

Go port of the BaseH (Base Human) reference codec. Zero dependencies,
stdlib only. Conforms to `spec/IMPLEMENTATION_CODEC.md` and the frozen
cross-language vectors in `vectors/`.

## Install

```sh
go get github.com/matellis/base-human/go
```

## Usage

```go
package main

import (
	"fmt"
	"math/big"

	basehuman "github.com/matellis/base-human/go"
)

func main() {
	key := []byte("application-secret-key-material")
	h, err := basehuman.NewBaseh(basehuman.Baseh32V1Profile(key, "prod-01"))
	if err != nil {
		panic(err) // invalid profile: fail at startup
	}

	code, err := h.Encode(big.NewInt(123456789))
	if err != nil {
		panic(err)
	}
	fmt.Println(code) // seven symbols, exact value depends on key material

	res, err := h.Decode("gzeyhtn", &basehuman.DecodeOptions{
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

Errors are always `*basehuman.Error` with a stable `Code` field (one of
`INVALID_PROFILE`, `OUT_OF_RANGE`, `PERMUTATION_FAILURE`, `INVALID_LENGTH`,
`INVALID_CHARACTER`, `INVALID_CHECKSUM`, `AMBIGUOUS_INPUT`,
`TOO_MANY_CANDIDATES` and `BLOCKED_CODE`), retrievable with `errors.As`.

The optional spec-18 `Profanity` field supports mode `no-vowels` (vowels
stripped from both alphabets) and mode `blocklist` (encode fails with
`BLOCKED_CODE` when the raw code contains a blocked substring).

## Test

```sh
go test -count=1 ./...
go vet ./...
```

`vectors_test.go` loads the shared conformance vectors from
`../vectors/*.json` and asserts every encode, decode, error, encode-error,
correction and Feistel case.
