package baseh

import (
	"fmt"
	"math/big"
	"strings"
	"unicode"
)

// zeroCodec is the immutable codec behind the zero-config pair. The frozen
// medium profile is valid by construction, so New cannot fail here.
var zeroCodec = mustZeroCodec()

func mustZeroCodec() *Codec {
	h, err := New(MediumV1())
	if err != nil {
		panic(err)
	}
	return h
}

// ToCode encodes an identifier with the zero-config Medium profile. No
// profile object and no key are needed. A nil, negative or out of range id
// and the rare BLOCKED_CODE identifiers return *Error.
func ToCode(id *big.Int) (string, error) {
	return zeroCodec.Encode(id)
}

// ToCodeString is ToCode for decimal strings. The input must be a
// non-negative base-10 integer with no sign, spaces or other decoration;
// anything else is a caller error and returns a plain error rather than
// *Error, mirroring the TypeError the reference port raises.
func ToCodeString(decimal string) (string, error) {
	id, err := parseDecimalID(decimal)
	if err != nil {
		return "", err
	}
	return ToCode(id)
}

func parseDecimalID(s string) (*big.Int, error) {
	if s == "" {
		return nil, fmt.Errorf("ToCodeString expects a non-negative decimal integer string, got %q", s)
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return nil, fmt.Errorf("ToCodeString expects a non-negative decimal integer string, got %q", s)
		}
	}
	id, ok := new(big.Int).SetString(s, 10)
	if !ok {
		return nil, fmt.Errorf("ToCodeString expects a non-negative decimal integer string, got %q", s)
	}
	return id, nil
}

// FromCode decodes a code from the zero-config Medium profile back to its
// identifier. Every whitespace character is stripped (edges and internal),
// lowercase and the typed aliases (O, I, L) are accepted and invalid input
// returns *Error with the matching code. No correction is ever attempted.
func FromCode(code string) (*big.Int, error) {
	stripped := strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, code)
	result, err := zeroCodec.Decode(stripped, nil)
	if err != nil {
		return nil, err
	}
	return result.ID, nil
}
