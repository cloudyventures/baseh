package baseh

// Frozen tiers. Each is built from the full alphanumeric set with cumulative
// visual and spoken strips; the spoken strips interact with the visual ones
// exactly as the web tools derive them, so the tool capacities match.
//
//	Minimum  36 symbols, no checksum, XXX-XXX      2,176,782,336 ids
//	Light    31 symbols, 2 checksums, XXXX-XXXX      887,503,681 ids
//	Medium   28 symbols, 2 checksums, XXXX-XXXX      481,890,304 ids (default)
//	Heavy    26 symbols, 2 checksums, XXXX-XXXX      308,915,776 ids
//
// All four keep the typed O/I/L aliases where possible, use a hyphen
// delimiter at the midpoint and run the default profanity blocklist. Every
// tier permutes with the frozen published key (FrozenKeyBytes below): the
// key is public, so the permutation obscures sequence but is not secrecy.
// The -p variants are identical but permute with caller-supplied key
// material instead.
//
// Every helper returns a freshly-built Profile value (fresh maps, slices
// and key bytes), so callers can load a default and modify it before
// New.

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
		checksumLength:   2,
		separator:        "-",
		grouping:         []int{4, 4},
		aliases:          tierAliases("D", "B", "T", "P"),
	}
}

func mediumShape() tierShape {
	return tierShape{
		profileID:        "baseh-medium",
		bodyAlphabet:     mediumBodyAlphabet,
		checksumAlphabet: mediumChecksumAlphabet,
		checksumLength:   2,
		separator:        "-",
		grouping:         []int{4, 4},
		// B and S are dropped for looking like 8 and 5; since they can never be
		// issued, a typed B is always an 8 and a typed S always a 5.
		aliases: tierAliases("B", "8", "S", "5", "T", "P", "N", "M", "W", "V"),
	}
}

func heavyShape() tierShape {
	return tierShape{
		profileID:        "baseh-heavy",
		bodyAlphabet:     heavyBodyAlphabet,
		checksumAlphabet: heavyChecksumAlphabet,
		checksumLength:   2,
		separator:        "-",
		grouping:         []int{4, 4},
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

// frozenKeyBytes is the frozen published permutation key. Public by design:
// it makes issued codes look non-sequential but offers no secrecy, since
// anyone can read it here. Never swap it on a live namespace; codes only
// decode with the key they were issued under. Use the -p variants to supply
// private key material. Unexported so no caller can mutate the shared key;
// FrozenKeyBytes returns a copy.
var frozenKeyBytes = []byte("baseh-frozen-key-v1")

// FrozenKeyBytes returns a copy of the frozen published permutation key.
// Callers may mutate the result freely; the shared key is never aliased.
func FrozenKeyBytes() []byte {
	return append([]byte(nil), frozenKeyBytes...)
}

// keyedPermutation builds the feistel-v1 permutation block for the -p
// variants. keyID defaults to "default" and rounds to 8 when zero. Key
// bytes are required: an empty keyBytes yields a profile that New
// rejects with INVALID_PROFILE. Key material is application-specific and
// never part of the frozen profile.
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

// frozenPermutation is the permutation every plain tier applies, built from
// the frozen published key. The key bytes are copied so a caller mutating
// the returned profile cannot corrupt the shared constant.
func frozenPermutation() Permutation {
	key := make([]byte, len(frozenKeyBytes))
	copy(key, frozenKeyBytes)
	return keyedPermutation(key, "frozen", 8)
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
		MaxRepetition:    4,
	}
}

// MinimumV1 returns the frozen baseh-minimum-v1 profile: alphanumeric,
// no safety strips, no checksum, hyphen-delimited XXX-XXX. Capacity
// 2,176,782,336 ids.
func MinimumV1() Profile {
	return buildTier(minimumShape(), frozenPermutation(), false)
}

// MinimumPV1 is baseh-minimum with feistel-v1 permutation. Key bytes
// are required; keyID defaults to "default" and rounds to 8.
func MinimumPV1(keyBytes []byte, keyID string, rounds int) Profile {
	return buildTier(minimumShape(), keyedPermutation(keyBytes, keyID, rounds), true)
}

// LightV1 returns the frozen baseh-light-v1 profile: visual light plus
// spoken light, two checksum symbols, hyphen-delimited. Capacity
// 887,503,681 ids.
func LightV1() Profile {
	return buildTier(lightShape(), frozenPermutation(), false)
}

// LightPV1 is baseh-light with feistel-v1 permutation. Key bytes
// are required; keyID defaults to "default" and rounds to 8.
func LightPV1(keyBytes []byte, keyID string, rounds int) Profile {
	return buildTier(lightShape(), keyedPermutation(keyBytes, keyID, rounds), true)
}

// MediumV1 returns the frozen baseh-medium-v1 profile: visual medium
// plus spoken medium, two checksum symbols, hyphen-delimited. Capacity
// 481,890,304 ids. The default tier.
func MediumV1() Profile {
	return buildTier(mediumShape(), frozenPermutation(), false)
}

// MediumPV1 is baseh-medium with feistel-v1 permutation. Key bytes
// are required; keyID defaults to "default" and rounds to 8.
func MediumPV1(keyBytes []byte, keyID string, rounds int) Profile {
	return buildTier(mediumShape(), keyedPermutation(keyBytes, keyID, rounds), true)
}

// HeavyV1 returns the frozen baseh-heavy-v1 profile: the most
// conservative alphabet plus spoken heavy, two checksum symbols,
// hyphen-delimited. Capacity 308,915,776 ids.
func HeavyV1() Profile {
	return buildTier(heavyShape(), frozenPermutation(), false)
}

// HeavyPV1 is baseh-heavy with feistel-v1 permutation. Key bytes
// are required; keyID defaults to "default" and rounds to 8.
func HeavyPV1(keyBytes []byte, keyID string, rounds int) Profile {
	return buildTier(heavyShape(), keyedPermutation(keyBytes, keyID, rounds), true)
}

// Spec 17.1: "the full alphanumeric set minus 0 and O (34 symbols; the
// zero ban of section 19.2)". The prose, the generation-capacity table
// (34^(L-effectiveK); 39,304 ids at length 4 with the spec-22.5 short
// checksum) and the checksum modulus (35^2 = 1,225) are all consistent
// only with 34 symbols.
const expandableBodyAlphabet = "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ"

// buildExpandableTier assembles the frozen expandable tier of spec 17.1:
// four characters while the namespace is small, gaining one symbol
// automatically as issuance climbs past each generation's capacity. The
// checksum alphabet derives as "0" plus the body (35 symbols, modulus
// 1225); per spec 22.5 the short checksum drops to a single symbol
// (modulus 35) through total length 5. The hyphen appears from six
// characters up, with the balanced grouping of spec 19.5 (no configurable
// pattern; grouping stays empty).
func buildExpandableTier(permutation Permutation, pSuffix bool) Profile {
	id := "baseh-expandable-v1"
	if pSuffix {
		id = "baseh-expandable-p-v1"
	}
	return Profile{
		ProfileID:           id,
		Mode:                "expandable",
		BodyAlphabet:        expandableBodyAlphabet,
		MinLength:           4,
		ChecksumAlphabet:    "0" + expandableBodyAlphabet,
		ChecksumLength:      2,
		ShortChecksumLength: 1,
		ShortChecksumUntil:  5,
		CaseSensitive:       false,
		Separator:           "-",
		SeparatorMinLength:  6,
		Grouping:            nil,
		Aliases:             tierAliases("T", "P", "N", "M", "W", "V"),
		Permutation:         permutation,
		Profanity:           Profanity{Mode: ProfanityBlocklist},
		MaxRepetition:       4,
	}
}

// ExpandableV1 returns the frozen baseh-expandable-v1 profile; the
// recommended starting point for new namespaces.
func ExpandableV1() Profile {
	return buildExpandableTier(frozenPermutation(), false)
}

// ExpandablePV1 is baseh-expandable with feistel-v1 permutation. Key
// bytes are required; keyID defaults to "default" and rounds to 8.
func ExpandablePV1(keyBytes []byte, keyID string, rounds int) Profile {
	return buildExpandableTier(keyedPermutation(keyBytes, keyID, rounds), true)
}
