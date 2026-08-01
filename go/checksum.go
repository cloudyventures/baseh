package baseh

import (
	"fmt"
	"math/big"
)

// checksumValue implements spec 6.2: a rolling polynomial over profile ID
// bytes and body symbol values, reduced modulo S^K. A body symbol outside
// the body alphabet fails with INVALID_CHARACTER.
// Spec 22: expandable generations may pass a shorter effective checksum
// length; the modulus is then S^length instead of the profile default.
func checksumValue(prep *prepared, body string, checksumLength int) (*big.Int, error) {
	modulus := prep.checksumModulus
	if checksumLength != prep.profile.ChecksumLength {
		modBase := len(prep.checksumNorm)
		if modBase == 0 {
			modBase = 1
		}
		modulus = new(big.Int).Exp(big.NewInt(int64(modBase)), big.NewInt(int64(checksumLength)), nil)
	}
	state := big.NewInt(17)
	multiplier := big.NewInt(37)
	tmp := new(big.Int)

	pid := prep.profile.ProfileID
	for i := 0; i < len(pid); i++ {
		state.Mul(state, multiplier)
		state.Add(state, tmp.SetInt64(int64(pid[i])+1))
		state.Mod(state, modulus)
	}
	state.Mul(state, multiplier)
	state.Mod(state, modulus)

	for pos := 0; pos < len(body); pos++ {
		symValue, ok := prep.bodyIndex[body[pos]]
		if !ok {
			return nil, newError(INVALID_CHARACTER, fmt.Sprintf("body symbol %q is not in the body alphabet", string(body[pos])), true)
		}
		state.Mul(state, multiplier)
		state.Add(state, tmp.SetInt64(symValue+int64(pos)+1))
		state.Mod(state, modulus)
	}
	return state, nil
}

// calculateChecksum returns the fixed-width checksum string for a normalized
// body. An empty string is returned when the effective checksum length is
// zero.
func calculateChecksum(prep *prepared, body string, checksumLength int) (string, error) {
	if checksumLength == 0 {
		return "", nil
	}
	value, err := checksumValue(prep, body, checksumLength)
	if err != nil {
		return "", err
	}
	return encodeBaseN(value, prep.checksumNorm, checksumLength), nil
}
