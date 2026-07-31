# basehuman (Go)

Go port of the HRC (Human Reference Code) codec. Zero dependencies, stdlib
only. Conforms to `spec/IMPLEMENTATION_CODEC.md` and the frozen
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
	h, err := basehuman.NewHrc(basehuman.HRC32V1Profile(key, "prod-01"))
	if err != nil {
		panic(err) // invalid profile: fail at startup
	}

	code, err := h.Encode(big.NewInt(123456789))
	if err != nil {
		panic(err)
	}
	fmt.Println(code) // example: VCS-PQ2-G (depends on key material)

	res, err := h.Decode("vcs pq2 g", &basehuman.DecodeOptions{
		AcceptSpaces: true,
	})
	if err != nil {
		panic(err)
	}
	fmt.Println(res.ID) // 123456789

	// Boolean-only check; never exposes an internal ID on failure.
	if !h.Validate("000-000-0", nil).Valid {
		fmt.Println("invalid code:", h.Validate("000-000-0", nil).Reason)
	}
}
```

Errors are always `*basehuman.Error` with a stable `Code` field (one of
`INVALID_PROFILE`, `OUT_OF_RANGE`, `PERMUTATION_FAILURE`, `INVALID_LENGTH`,
`INVALID_CHARACTER`, `INVALID_CHECKSUM`, `AMBIGUOUS_INPUT` and
`TOO_MANY_CANDIDATES`), retrievable with `errors.As`.

## Test

```sh
go test ./...
go vet ./...
```

`vectors_test.go` loads the shared conformance vectors from
`../vectors/*.json` and asserts every encode, decode, error, correction and
Feistel case.
