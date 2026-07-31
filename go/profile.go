package basehuman

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
)

// Profile describes one HRC encoding configuration. JSON tags match the
// shared cross-language vector definitions exactly.
type Profile struct {
	ProfileID        string            `json:"profileId"`
	BodyAlphabet     string            `json:"bodyAlphabet"`
	BodyLength       int               `json:"bodyLength"`
	ChecksumAlphabet string            `json:"checksumAlphabet"`
	ChecksumLength   int               `json:"checksumLength"`
	CaseSensitive    bool              `json:"caseSensitive"`
	Separator        string            `json:"separator"`
	Grouping         []int             `json:"grouping"`
	Aliases          map[string]string `json:"aliases"`
	Permutation      Permutation       `json:"permutation"`
}

// Permutation configures the optional reversible Feistel permutation.
type Permutation struct {
	Enabled   bool   `json:"enabled"`
	Algorithm string `json:"algorithm"`
	KeyID     string `json:"keyId"`
	// KeyBytes holds the key material. When empty and KeyBytesHex is set,
	// NewHrc decodes KeyBytesHex instead (the vector file format).
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
	profile          Profile
	bodyNorm         string
	checksumNorm     string
	aliasesNorm      map[byte]byte
	bodyIndex        map[byte]int64
	checksumIndex    map[byte]int64
	checksumModulus  *big.Int
	capacity         *big.Int
	permutationKey   feistelKey
	allowedByte      [128]bool
	inBodyAlphabet   [128]bool
	inChecksumAlpha  [128]bool
	rawLength        int
}

// prepareProfile validates a profile per spec section 2.2 and returns it with
// derived precomputed values. Any violation returns INVALID_PROFILE.
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
	bodyNorm := normString(p.CaseSensitive, p.BodyAlphabet)
	if !allUnique(bodyNorm) {
		return nil, invalidProfile("body alphabet symbols must be unique after case normalization")
	}

	if p.BodyLength < 1 || p.BodyLength > 32 {
		return nil, invalidProfile("bodyLength must be an integer from 1 through 32")
	}
	if p.ChecksumLength < 0 || p.ChecksumLength > 8 {
		return nil, invalidProfile("checksumLength must be an integer from 0 through 8")
	}

	checksumAlphabet := p.ChecksumAlphabet
	if p.ChecksumLength > 0 {
		if len(checksumAlphabet) < 2 {
			return nil, invalidProfile("checksumAlphabet needs at least two symbols when checksumLength is positive")
		}
		if !isASCIIString(checksumAlphabet) {
			return nil, invalidProfile("checksum alphabet symbols must be single ASCII characters")
		}
	} else if !isASCIIString(checksumAlphabet) {
		return nil, invalidProfile("checksum alphabet symbols must be single ASCII characters")
	}
	checksumNorm := normString(p.CaseSensitive, checksumAlphabet)
	if !allUnique(checksumNorm) {
		return nil, invalidProfile("checksum alphabet symbols must be unique after case normalization")
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
		if canonical[sNorm] {
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

	groupTotal := 0
	for _, g := range p.Grouping {
		if g < 1 {
			return nil, invalidProfile("group sizes must be positive integers")
		}
		groupTotal += g
	}
	if len(p.Grouping) == 0 {
		groupTotal = -1
	}
	if groupTotal != p.BodyLength+p.ChecksumLength {
		return nil, invalidProfile("group sizes must sum to bodyLength + checksumLength")
	}

	prep := &prepared{
		profile:     p,
		bodyNorm:    bodyNorm,
		checksumNorm: checksumNorm,
		aliasesNorm: aliasesNorm,
		rawLength:   p.BodyLength + p.ChecksumLength,
	}

	prep.bodyIndex = make(map[byte]int64, len(bodyNorm))
	for i := 0; i < len(bodyNorm); i++ {
		prep.bodyIndex[bodyNorm[i]] = int64(i)
		prep.inBodyAlphabet[bodyNorm[i]] = true
		prep.allowedByte[bodyNorm[i]] = true
	}
	prep.checksumIndex = make(map[byte]int64, len(checksumNorm))
	for i := 0; i < len(checksumNorm); i++ {
		prep.checksumIndex[checksumNorm[i]] = int64(i)
		prep.inChecksumAlpha[checksumNorm[i]] = true
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
