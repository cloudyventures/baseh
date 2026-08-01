package baseh

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
)

// Profile describes one baseH encoding configuration. JSON tags match the
// shared cross-language vector definitions exactly.
type Profile struct {
	ProfileID string `json:"profileId"`
	// Mode is "fixed" or "expandable" (spec 2.1/19.9). The zero value ""
	// selects "fixed", so profiles that predate the field keep their
	// frozen byte-for-byte behaviour.
	Mode         string `json:"mode,omitempty"`
	BodyAlphabet string `json:"bodyAlphabet"`
	// BodyLength applies to fixed mode only; ignored in expandable mode.
	BodyLength int `json:"bodyLength"`
	// MinLength applies to expandable mode only; the zero value selects
	// the spec default of 4. It must exceed ChecksumLength.
	MinLength int `json:"minLength,omitempty"`
	// SeparatorMinLength applies to expandable mode only; below this total
	// length the separator is omitted. The zero value selects 0 (the
	// separator always applies). It must be 0 in fixed mode.
	SeparatorMinLength int    `json:"separatorMinLength,omitempty"`
	ChecksumAlphabet   string `json:"checksumAlphabet"`
	ChecksumLength     int    `json:"checksumLength"`
	// ShortChecksumLength applies to expandable mode only (spec 22). When
	// ShortChecksumUntil is set, generations at or below it use this many
	// checksum symbols instead of ChecksumLength; 0 is a legal
	// zero-checksum window (no typo detection at those generations). When
	// the window is off this field must be 0. Both fields must be 0 in
	// fixed mode.
	ShortChecksumLength int `json:"shortChecksumLength,omitempty"`
	// ShortChecksumUntil is the last generation (total length) that uses
	// the short checksum; it is the feature switch — 0 or absent turns the
	// feature off, and ShortChecksumLength must then be 0 as well. A set
	// window alone is a legal zero-checksum window.
	ShortChecksumUntil int               `json:"shortChecksumUntil,omitempty"`
	CaseSensitive      bool              `json:"caseSensitive"`
	Separator          string            `json:"separator"`
	Grouping           []int             `json:"grouping"`
	Aliases            map[string]string `json:"aliases"`
	Permutation        Permutation       `json:"permutation"`
	// Profanity is the optional spec-18 configuration. The zero value
	// (mode "") selects mode "none".
	Profanity Profanity `json:"profanity,omitempty"`
	// MaxRepetition is the optional spec-21 repetition filter. The zero
	// value disables it; when on it must be an integer of at least 3.
	MaxRepetition int `json:"maxRepetition,omitempty"`
}

// Permutation configures the optional reversible Feistel permutation.
type Permutation struct {
	Enabled   bool   `json:"enabled"`
	Algorithm string `json:"algorithm"`
	KeyID     string `json:"keyId"`
	// KeyBytes holds the key material. When empty and KeyBytesHex is set,
	// New decodes KeyBytesHex instead (the vector file format).
	KeyBytes    []byte `json:"-"`
	KeyBytesHex string `json:"keyBytesHex,omitempty"`
	Rounds      int    `json:"rounds"`
}

func isASCIIByte(b byte) bool { return b >= 0x20 && b <= 0x7e }

func isASCIIString(s string) bool {
	for i := 0; i < len(s); i++ {
		if !isASCIIByte(s[i]) {
			return false
		}
	}
	return true
}

func normByte(caseSensitive bool, b byte) byte {
	if !caseSensitive && b >= 'a' && b <= 'z' {
		return b - ('a' - 'A')
	}
	return b
}

func normString(caseSensitive bool, s string) string {
	if caseSensitive {
		return s
	}
	return strings.ToUpper(s)
}

// prepared holds validated profile data precomputed once at construction.
type prepared struct {
	profile            Profile
	mode               string
	minLength          int
	separatorMinLength int
	bodyNorm           string
	checksumNorm       string
	aliasesNorm        map[byte]byte
	bodyIndex          map[byte]int64
	checksumModulus    *big.Int
	capacity           *big.Int
	permutationKey     feistelKey
	blocklist          []string
	allowedByte        [128]bool
	rawLength          int
}

// prepareProfile validates a profile per spec section 2.2 (plus the spec-18
// profanity and separator/grouping rules) and returns it with derived
// precomputed values. Any violation returns INVALID_PROFILE.
func prepareProfile(p Profile) (*prepared, error) {
	if p.ProfileID == "" {
		return nil, invalidProfile("profileId must be non-empty")
	}
	if !isASCIIString(p.ProfileID) {
		return nil, invalidProfile("profileId must be ASCII")
	}

	if len(p.BodyAlphabet) < 2 {
		return nil, invalidProfile("bodyAlphabet needs at least two symbols")
	}
	if !isASCIIString(p.BodyAlphabet) {
		return nil, invalidProfile("body alphabet symbols must be single ASCII characters")
	}
	// Spec 2.2/19.9: a missing mode is fixed, so frozen profiles keep
	// matching byte for byte.
	mode := p.Mode
	if mode == "" {
		mode = "fixed"
	}
	if mode != "fixed" && mode != "expandable" {
		return nil, invalidProfile("mode must be fixed or expandable")
	}

	bodyNorm := normString(p.CaseSensitive, p.BodyAlphabet)
	// Spec 19.2: in expandable mode the zero ban strips 0 and O from the
	// body alphabet silently, before any other validation, exactly like
	// the no-vowels strip of section 18.1.
	if mode == "expandable" {
		bodyNorm = strings.Map(func(r rune) rune {
			if r == '0' || r == 'O' {
				return -1
			}
			return r
		}, bodyNorm)
	}
	if !allUnique(bodyNorm) {
		return nil, invalidProfile("body alphabet symbols must be unique after case normalization")
	}

	if mode == "fixed" {
		if p.BodyLength < 1 || p.BodyLength > 32 {
			return nil, invalidProfile("bodyLength must be an integer from 1 through 32")
		}
	}
	minLength := p.MinLength
	if minLength == 0 {
		minLength = 4
	}
	separatorMinLength := p.SeparatorMinLength
	if mode == "fixed" && separatorMinLength != 0 {
		return nil, invalidProfile("separatorMinLength must be 0 in fixed mode")
	}
	if p.ChecksumLength < 0 || p.ChecksumLength > 8 {
		return nil, invalidProfile("checksumLength must be an integer from 0 through 8")
	}
	// Spec 21: 0 disables the repetition filter; banning runs shorter than
	// three would destroy too much of every generation, so 1 and 2 are
	// rejected. There is no upper bound — a value above the code length is
	// a legal no-op.
	if p.MaxRepetition < 0 || (p.MaxRepetition > 0 && p.MaxRepetition < 3) {
		return nil, invalidProfile("maxRepetition must be 0 (off) or an integer of at least 3")
	}
	if mode == "expandable" {
		if minLength < 1 {
			return nil, invalidProfile("minLength must be an integer of at least 1")
		}
		if minLength <= p.ChecksumLength {
			return nil, invalidProfile("minLength must be greater than checksumLength")
		}
		if separatorMinLength < 0 {
			return nil, invalidProfile("separatorMinLength must be an integer of at least 0")
		}
	}

	// Spec 22. The short checksum is expandable-only, and the window field
	// is the switch: a shortChecksumUntil of 0 or absent turns the feature
	// off, and the length must then be 0 as well. A set window with a
	// length of 0 is a legal zero-checksum window. Go ints are always
	// integers, so only the range rules apply.
	if mode == "fixed" {
		if p.ShortChecksumLength != 0 || p.ShortChecksumUntil != 0 {
			return nil, invalidProfile("shortChecksumLength and shortChecksumUntil are expandable-mode only")
		}
	} else if p.ShortChecksumUntil != 0 {
		if p.ShortChecksumUntil < minLength {
			return nil, invalidProfile("shortChecksumUntil must be an integer of at least minLength")
		}
		if p.ShortChecksumUntil > 8 {
			return nil, invalidProfile("shortChecksumUntil must be at most 8")
		}
		if p.ShortChecksumLength < 0 || p.ShortChecksumLength >= p.ChecksumLength {
			return nil, invalidProfile("shortChecksumLength must be an integer from 0 through checksumLength - 1")
		}
		if minLength <= p.ShortChecksumLength {
			return nil, invalidProfile("minLength must be greater than shortChecksumLength")
		}
	} else if p.ShortChecksumLength != 0 {
		return nil, invalidProfile("shortChecksumLength requires shortChecksumUntil")
	}

	checksumAlphabet := p.ChecksumAlphabet
	var checksumNorm string
	if mode == "expandable" {
		// Spec 19.3: the checksum alphabet is derived, "0" followed by the
		// body alphabet in order. The configured checksumAlphabet is not
		// consulted; checksumNorm is set after every body strip below.
		checksumNorm = ""
	} else {
		if !isASCIIString(checksumAlphabet) {
			return nil, invalidProfile("checksum alphabet symbols must be single ASCII characters")
		}
		if p.ChecksumLength > 0 && len(checksumAlphabet) < 2 {
			return nil, invalidProfile("checksumAlphabet needs at least two symbols when checksumLength is positive")
		}
		checksumNorm = normString(p.CaseSensitive, checksumAlphabet)
		if !allUnique(checksumNorm) {
			return nil, invalidProfile("checksum alphabet symbols must be unique after case normalization")
		}
	}

	// Spec 18. no-vowels strips vowels before every downstream rule;
	// blocklist only arms the encode-time scan.
	profanityMode := p.Profanity.Mode
	if profanityMode == "" {
		profanityMode = ProfanityNone
	}
	var blocklist []string
	switch profanityMode {
	case ProfanityNone:
	case ProfanityNoVowels:
		bodyNorm = stripVowels(bodyNorm)
		checksumNorm = stripVowels(checksumNorm)
		if len(bodyNorm) < 2 {
			return nil, invalidProfile("no-vowels mode leaves the body alphabet with fewer than two symbols")
		}
		if mode == "fixed" && p.ChecksumLength > 0 && len(checksumNorm) < 2 {
			return nil, invalidProfile("no-vowels mode leaves the checksum alphabet with fewer than two symbols")
		}
	case ProfanityBlocklist:
		list, err := effectiveBlocklist(p.Profanity)
		if err != nil {
			return nil, err
		}
		blocklist = list
	default:
		return nil, invalidProfile("profanity mode must be none, no-vowels or blocklist")
	}
	if mode == "expandable" {
		// Spec 19.3: derived after every body strip (zero ban, no-vowels)
		// so all downstream rules — modulus, separator collision, alias
		// targets — see the final alphabets.
		checksumNorm = "0" + bodyNorm
	}
	if len(bodyNorm) < 2 {
		return nil, invalidProfile("body alphabet needs at least two symbols after preparation")
	}

	for i := 0; i < len(p.Separator); i++ {
		if strings.IndexByte(bodyNorm, p.Separator[i]) >= 0 ||
			strings.IndexByte(checksumNorm, p.Separator[i]) >= 0 {
			return nil, invalidProfile("separator must not occur in either alphabet")
		}
	}

	canonical := make(map[byte]bool)
	for i := 0; i < len(bodyNorm); i++ {
		canonical[bodyNorm[i]] = true
	}
	for i := 0; i < len(checksumNorm); i++ {
		canonical[checksumNorm[i]] = true
	}

	aliasSourceNorm := make(map[byte]bool)
	for src := range p.Aliases {
		if len(src) == 1 && isASCIIByte(src[0]) {
			aliasSourceNorm[normByte(p.CaseSensitive, src[0])] = true
		}
	}

	aliasesNorm := make(map[byte]byte)
	for src, tgt := range p.Aliases {
		if len(src) != 1 || !isASCIIByte(src[0]) {
			return nil, invalidProfile(fmt.Sprintf("alias source is not single ASCII: %q", src))
		}
		if len(tgt) != 1 || !isASCIIByte(tgt[0]) {
			return nil, invalidProfile(fmt.Sprintf("alias target is not single ASCII: %q", tgt))
		}
		sNorm := normByte(p.CaseSensitive, src[0])
		tNorm := normByte(p.CaseSensitive, tgt[0])
		// Spec 3.2: an alias must never map two distinct canonical symbols
		// into one value. Fixed mode rejects a canonical alias source
		// outright. In expandable mode the frozen tier (spec 17.1) carries
		// aliases whose sources are canonical body symbols (T, N, W stay in
		// the body alphabet); the canonical symbol wins at normalization,
		// making those entries inert instead of destructive.
		if mode == "fixed" && canonical[sNorm] {
			return nil, invalidProfile(fmt.Sprintf("alias source %q is already a canonical symbol", src))
		}
		if !canonical[tNorm] {
			return nil, invalidProfile(fmt.Sprintf("alias target %q is not a canonical symbol", tgt))
		}
		if _, dup := aliasesNorm[sNorm]; dup {
			return nil, invalidProfile(fmt.Sprintf("duplicate alias source %q after case normalization", src))
		}
		if aliasSourceNorm[tNorm] {
			return nil, invalidProfile(fmt.Sprintf("alias chain or cycle forbidden: target %q is also an alias source", tgt))
		}
		aliasesNorm[sNorm] = tNorm
	}

	if p.Separator == "" {
		if len(p.Grouping) != 0 {
			return nil, invalidProfile("grouping must be empty when separator is empty")
		}
	} else {
		groupTotal := 0
		for _, g := range p.Grouping {
			if g < 1 {
				return nil, invalidProfile("group sizes must be positive integers")
			}
			groupTotal += g
		}
		if mode == "expandable" {
			// Spec 19.5/2.2: expandable grouping is a balanced function of
			// the total length, so a configured pattern is rejected.
			if len(p.Grouping) != 0 {
				return nil, invalidProfile("grouping must be empty in expandable mode")
			}
		} else if len(p.Grouping) == 0 || groupTotal != p.BodyLength+p.ChecksumLength {
			return nil, invalidProfile("group sizes must sum to bodyLength + checksumLength")
		}
	}

	prep := &prepared{
		profile:            p,
		mode:               mode,
		minLength:          minLength,
		separatorMinLength: separatorMinLength,
		bodyNorm:           bodyNorm,
		checksumNorm:       checksumNorm,
		aliasesNorm:        aliasesNorm,
		blocklist:          blocklist,
		rawLength:          p.BodyLength + p.ChecksumLength,
	}

	prep.bodyIndex = make(map[byte]int64, len(bodyNorm))
	for i := 0; i < len(bodyNorm); i++ {
		prep.bodyIndex[bodyNorm[i]] = int64(i)
		prep.allowedByte[bodyNorm[i]] = true
	}
	for i := 0; i < len(checksumNorm); i++ {
		prep.allowedByte[checksumNorm[i]] = true
	}

	modBase := len(checksumNorm)
	if modBase == 0 {
		modBase = 1
	}
	prep.checksumModulus = new(big.Int).Exp(big.NewInt(int64(modBase)), big.NewInt(int64(p.ChecksumLength)), nil)
	prep.capacity = new(big.Int).Exp(big.NewInt(int64(len(bodyNorm))), big.NewInt(int64(p.BodyLength)), nil)

	if p.Permutation.Enabled {
		if p.Permutation.Algorithm != "feistel-v1" {
			return nil, invalidProfile("unknown permutation algorithm")
		}
		if p.Permutation.KeyID == "" {
			return nil, invalidProfile("permutation requires a keyId")
		}
		keyBytes := p.Permutation.KeyBytes
		if len(keyBytes) == 0 && p.Permutation.KeyBytesHex != "" {
			decoded, err := hex.DecodeString(p.Permutation.KeyBytesHex)
			if err != nil {
				return nil, invalidProfile("permutation keyBytesHex is not valid hexadecimal")
			}
			keyBytes = decoded
		}
		if len(keyBytes) == 0 {
			return nil, invalidProfile("permutation requires key material")
		}
		rounds := p.Permutation.Rounds
		if rounds < 4 || rounds > 16 || rounds%2 != 0 {
			return nil, invalidProfile("Feistel rounds must be an even integer from 4 through 16")
		}
		keyCopy := make([]byte, len(keyBytes))
		copy(keyCopy, keyBytes)
		prep.permutationKey = feistelKey{
			profileID: p.ProfileID,
			keyBytes:  keyCopy,
			rounds:    rounds,
		}
	}

	return prep, nil
}

// effectiveChecksumLength implements spec 22: the checksum length that
// applies to a generation of the given total length — ShortChecksumLength
// at or below ShortChecksumUntil, ChecksumLength above it (and always in
// fixed mode).
func effectiveChecksumLength(prep *prepared, length int) int {
	p := prep.profile
	if prep.mode == "expandable" && p.ShortChecksumUntil > 0 && length <= p.ShortChecksumUntil {
		return p.ShortChecksumLength
	}
	return p.ChecksumLength
}

func allUnique(s string) bool {
	seen := make(map[byte]bool, len(s))
	for i := 0; i < len(s); i++ {
		if seen[s[i]] {
			return false
		}
		seen[s[i]] = true
	}
	return true
}
