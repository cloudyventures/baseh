package basehuman

const (
	frozenBodyAlphabet     = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
	frozenChecksumAlphabet = "234679ACDEFGHJKMNPQRTUVWXY"
)

func frozenAliases() map[string]string {
	return map[string]string{"O": "0", "I": "1", "L": "1"}
}

// HRC32V1Profile returns the frozen assisted-support profile hrc32-v1:
// 6 body plus 1 checksum symbol with the feistel-v1 permutation. Key
// material is application-specific and never part of the frozen profile;
// see spec 7.4.
func HRC32V1Profile(keyBytes []byte, keyID string) Profile {
	return Profile{
		ProfileID:        "hrc32-v1",
		BodyAlphabet:     frozenBodyAlphabet,
		BodyLength:       6,
		ChecksumAlphabet: frozenChecksumAlphabet,
		ChecksumLength:   1,
		CaseSensitive:    false,
		Separator:        "-",
		Grouping:         []int{3, 3, 1},
		Aliases:          frozenAliases(),
		Permutation: Permutation{
			Enabled:   true,
			Algorithm: "feistel-v1",
			KeyID:     keyID,
			KeyBytes:  keyBytes,
			Rounds:    8,
		},
	}
}

// HRC32SV1Profile returns the frozen self-service profile hrc32s-v1:
// 6 body plus 2 checksum symbols. Detects all single-symbol substitutions
// and all adjacent transpositions; see spec 6.3.
func HRC32SV1Profile(keyBytes []byte, keyID string) Profile {
	p := HRC32V1Profile(keyBytes, keyID)
	p.ProfileID = "hrc32s-v1"
	p.ChecksumLength = 2
	p.Grouping = []int{3, 3, 2}
	return p
}
