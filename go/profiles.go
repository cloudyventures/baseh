package basehuman

const (
	frozenBodyAlphabet     = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
	frozenChecksumAlphabet = "234679ACDEFGHJKMNPQRTUVWXY"
)

func frozenAliases() map[string]string {
	return map[string]string{"O": "0", "I": "1", "L": "1"}
}

// Baseh32V1Profile returns the frozen assisted-support profile baseh32-v1:
// 6 body plus 1 checksum symbol and no separators. The feistel-v1
// permutation is opt-in: pass nil or empty keyBytes for an unpermuted
// profile (keyID is then ignored). With keyBytes non-empty, keyID defaults
// to "default" and rounds fixed at 8. Key material is application-specific
// and never part of the frozen profile; see spec 7.4.
func Baseh32V1Profile(keyBytes []byte, keyID string) Profile {
	permutation := Permutation{Enabled: false}
	if len(keyBytes) > 0 {
		if keyID == "" {
			keyID = "default"
		}
		permutation = Permutation{
			Enabled:   true,
			Algorithm: "feistel-v1",
			KeyID:     keyID,
			KeyBytes:  keyBytes,
			Rounds:    8,
		}
	}
	return Profile{
		ProfileID:        "baseh32-v1",
		BodyAlphabet:     frozenBodyAlphabet,
		BodyLength:       6,
		ChecksumAlphabet: frozenChecksumAlphabet,
		ChecksumLength:   1,
		CaseSensitive:    false,
		Separator:        "",
		Grouping:         nil,
		Aliases:          frozenAliases(),
		Permutation:      permutation,
	}
}

// Baseh32SV1Profile returns the frozen self-service profile baseh32s-v1:
// 6 body plus 2 checksum symbols. Detects all single-symbol substitutions
// and all adjacent transpositions; see spec 6.3.
func Baseh32SV1Profile(keyBytes []byte, keyID string) Profile {
	p := Baseh32V1Profile(keyBytes, keyID)
	p.ProfileID = "baseh32s-v1"
	p.ChecksumLength = 2
	return p
}
