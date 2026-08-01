package basehuman

// Frozen tiers. Each is built from the full alphanumeric set with cumulative
// visual and spoken strips; the spoken strips interact with the visual ones
// exactly as the web tools derive them, so the tool capacities match.
//
//	Minimum  36 symbols, no checksum           2,176,782,336 ids
//	Light    31 symbols, 1 checksum              887,503,681 ids
//	Medium   28 symbols, 1 checksum              481,890,304 ids (default)
//	Heavy    26 symbols, 1 checksum              308,915,776 ids
//
// All four keep the typed O/I/L aliases where possible and run the default
// profanity blocklist. Minimum also uses a hyphen delimiter; the rest have
// none. The -p variants are identical but with feistel-v1 permutation and
// require caller-supplied key material.
//
// Every helper returns a freshly-built Profile value (fresh maps and
// slices), so callers can load a default and modify it before NewBaseh.

const (
	minimumBodyAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	lightBodyAlphabet   = "0123456789ABCEFGHJKMNPQRSUVWXYZ"
	mediumBodyAlphabet  = "0123456789ACDEFGHJKMPQRUVXYZ"
	heavyBodyAlphabet   = "0123456789ABCEFHJKMPQRVXYZ"

	lightChecksumAlphabet  = "234679ACEFGHJKMNPQRUVWXY"
	mediumChecksumAlphabet = "234679ACDEFGHJKMPQRUVXY"
	heavyChecksumAlphabet  = "234679ACEFHJKMPQRUVXY"
)

// tierShape holds the per-tier parts that differ; body length,
// case sensitivity and the blocklist mode are tier-wide.
type tierShape struct {
	profileID        string
	bodyAlphabet     string
	checksumAlphabet string
	checksumLength   int
	separator        string
	grouping         []int
	aliases          map[string]string
}

func minimumShape() tierShape {
	return tierShape{
		profileID:        "baseh-minimum",
		bodyAlphabet:     minimumBodyAlphabet,
		checksumAlphabet: "",
		checksumLength:   0,
		separator:        "-",
		grouping:         []int{3, 3},
		aliases:          map[string]string{},
	}
}

func lightShape() tierShape {
	return tierShape{
		profileID:        "baseh-light",
		bodyAlphabet:     lightBodyAlphabet,
		checksumAlphabet: lightChecksumAlphabet,
		checksumLength:   1,
		separator:        "",
		grouping:         nil,
		aliases:          tierAliases("D", "B", "T", "P"),
	}
}

func mediumShape() tierShape {
	return tierShape{
		profileID:        "baseh-medium",
		bodyAlphabet:     mediumBodyAlphabet,
		checksumAlphabet: mediumChecksumAlphabet,
		checksumLength:   1,
		separator:        "",
		grouping:         nil,
		aliases:          tierAliases("T", "P", "N", "M", "W", "V"),
	}
}

func heavyShape() tierShape {
	return tierShape{
		profileID:        "baseh-heavy",
		bodyAlphabet:     heavyBodyAlphabet,
		checksumAlphabet: heavyChecksumAlphabet,
		checksumLength:   1,
		separator:        "",
		grouping:         nil,
		aliases:          tierAliases("D", "B", "T", "P", "N", "M", "W", "V", "S", "F", "G", "C"),
	}
}

// tierAliases builds a fresh alias map: the typed O/I/L aliases plus the
// given source/target pairs.
func tierAliases(pairs ...string) map[string]string {
	m := map[string]string{"O": "0", "I": "1", "L": "1"}
	for i := 0; i+1 < len(pairs); i += 2 {
		m[pairs[i]] = pairs[i+1]
	}
	return m
}

// keyedPermutation builds the feistel-v1 permutation block for the -p
// variants. keyID defaults to "default" and rounds to 8 when zero. Key
// bytes are required: an empty keyBytes yields a profile that NewBaseh
// rejects with INVALID_PROFILE. Key material is application-specific and
// never part of the frozen profile; see spec 7.4.
func keyedPermutation(keyBytes []byte, keyID string, rounds int) Permutation {
	if keyID == "" {
		keyID = "default"
	}
	if rounds == 0 {
		rounds = 8
	}
	return Permutation{
		Enabled:   true,
		Algorithm: "feistel-v1",
		KeyID:     keyID,
		KeyBytes:  keyBytes,
		Rounds:    rounds,
	}
}

func buildTier(shape tierShape, permutation Permutation, pSuffix bool) Profile {
	id := shape.profileID + "-v1"
	if pSuffix {
		id = shape.profileID + "-p-v1"
	}
	return Profile{
		ProfileID:        id,
		BodyAlphabet:     shape.bodyAlphabet,
		BodyLength:       6,
		ChecksumAlphabet: shape.checksumAlphabet,
		ChecksumLength:   shape.checksumLength,
		CaseSensitive:    false,
		Separator:        shape.separator,
		Grouping:         shape.grouping,
		Aliases:          shape.aliases,
		Permutation:      permutation,
		Profanity:        Profanity{Mode: ProfanityBlocklist},
	}
}

// BasehMinimumV1 returns the frozen baseh-minimum-v1 profile: the full 36
// symbol alphanumeric alphabet, no checksum, hyphen-delimited XXX-XXX.
// Capacity 2,176,782,336 ids.
func BasehMinimumV1() Profile {
	return buildTier(minimumShape(), Permutation{Enabled: false}, false)
}

// BasehMinimumPV1 is baseh-minimum with feistel-v1 permutation. Key bytes
// are required; keyID defaults to "default" and rounds to 8.
func BasehMinimumPV1(keyBytes []byte, keyID string, rounds int) Profile {
	return buildTier(minimumShape(), keyedPermutation(keyBytes, keyID, rounds), true)
}

// BasehLightV1 returns the frozen baseh-light-v1 profile: visual light plus
// spoken light strips, one checksum symbol. Capacity 887,503,681 ids.
func BasehLightV1() Profile {
	return buildTier(lightShape(), Permutation{Enabled: false}, false)
}

// BasehLightPV1 is baseh-light with feistel-v1 permutation. Key bytes
// are required; keyID defaults to "default" and rounds to 8.
func BasehLightPV1(keyBytes []byte, keyID string, rounds int) Profile {
	return buildTier(lightShape(), keyedPermutation(keyBytes, keyID, rounds), true)
}

// BasehMediumV1 returns the frozen baseh-medium-v1 profile: visual medium
// plus spoken medium, one checksum symbol. Capacity 481,890,304 ids. The
// default tier.
func BasehMediumV1() Profile {
	return buildTier(mediumShape(), Permutation{Enabled: false}, false)
}

// BasehMediumPV1 is baseh-medium with feistel-v1 permutation. Key bytes
// are required; keyID defaults to "default" and rounds to 8.
func BasehMediumPV1(keyBytes []byte, keyID string, rounds int) Profile {
	return buildTier(mediumShape(), keyedPermutation(keyBytes, keyID, rounds), true)
}

// BasehHeavyV1 returns the frozen baseh-heavy-v1 profile: the most
// conservative alphabet plus spoken heavy, one checksum symbol. Capacity
// 308,915,776 ids.
func BasehHeavyV1() Profile {
	return buildTier(heavyShape(), Permutation{Enabled: false}, false)
}

// BasehHeavyPV1 is baseh-heavy with feistel-v1 permutation. Key bytes
// are required; keyID defaults to "default" and rounds to 8.
func BasehHeavyPV1(keyBytes []byte, keyID string, rounds int) Profile {
	return buildTier(heavyShape(), keyedPermutation(keyBytes, keyID, rounds), true)
}
