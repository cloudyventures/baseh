package basehuman

import (
	"fmt"
	"math/big"
)

// encodeBaseN is spec 5.1: fixed-length base-N encode, most significant
// digit first. The caller guarantees 0 <= value < base^length.
func encodeBaseN(value *big.Int, alphabet string, length int) string {
	base := big.NewInt(int64(len(alphabet)))
	out := make([]byte, length)
	v := new(big.Int).Set(value)
	mod := new(big.Int)
	for pos := length - 1; pos >= 0; pos-- {
		v.QuoRem(v, base, mod)
		out[pos] = alphabet[mod.Int64()]
	}
	return string(out)
}

// decodeBaseN is spec 5.2.
func decodeBaseN(text string, base int, index map[byte]int64) (*big.Int, error) {
	value := new(big.Int)
	b := big.NewInt(int64(base))
	for i := 0; i < len(text); i++ {
		digit, ok := index[text[i]]
		if !ok {
			return nil, newError(INVALID_CHARACTER, fmt.Sprintf("symbol %q is not in the alphabet", string(text[i])), true)
		}
		value.Mul(value, b)
		value.Add(value, big.NewInt(digit))
	}
	return value, nil
}
