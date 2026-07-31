package basehuman

import "math/big"

// checksumValue implements spec 6.2: a rolling polynomial over profile ID
// bytes and body symbol values, reduced modulo S^K.
func checksumValue(prep *prepared, body string) *big.Int {
	modulus := prep.checksumModulus
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
		state.Mul(state, multiplier)
		state.Add(state, tmp.SetInt64(prep.bodyIndex[body[pos]]+int64(pos)+1))
		state.Mod(state, modulus)
	}
	return state
}

// calculateChecksum returns the fixed-width checksum string for a normalized
// body. An empty string is returned when checksumLength is zero.
func calculateChecksum(prep *prepared, body string) string {
	if prep.profile.ChecksumLength == 0 {
		return ""
	}
	value := checksumValue(prep, body)
	return encodeBaseN(value, prep.checksumNorm, prep.profile.ChecksumLength)
}
