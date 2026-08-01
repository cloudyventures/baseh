package basehuman

import "strings"

// ProfanityMode selects the profanity safety strategy of spec 18.
type ProfanityMode string

// Profanity safety modes.
const (
	ProfanityNone      ProfanityMode = "none"
	ProfanityNoVowels  ProfanityMode = "no-vowels"
	ProfanityBlocklist ProfanityMode = "blocklist"
)

// Profanity is the optional profanity safety configuration of spec 18. A
// zero value means mode "none".
type Profanity struct {
	Mode ProfanityMode `json:"mode"`
	// Words replaces the default list when non-nil (blocklist mode only).
	Words []string `json:"words,omitempty"`
	// ExtraWords is appended to the effective list in either case.
	ExtraWords []string `json:"extraWords,omitempty"`
}

// DefaultBlocklist is the spec 18.2 default list. Deliberately small;
// applications extend it with Words or ExtraWords.
var DefaultBlocklist = []string{
	"CRAP", "TWAT", "SHAG", "DAMN", "FCK", "FUC",
	"SHT", "CNT", "TWT", "DCK", "AZZ", "BCH",
}

// isBlocklistWord reports whether s is 2 through 32 ASCII letters.
func isBlocklistWord(s string) bool {
	if len(s) < 2 || len(s) > 32 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c < 'A' || c > 'Z') && (c < 'a' || c > 'z') {
			return false
		}
	}
	return true
}

// effectiveBlocklist implements spec 18.2: replacement semantics, then
// augmentation, uppercased and deduplicated.
func effectiveBlocklist(p Profanity) ([]string, error) {
	base := p.Words
	if base == nil {
		base = DefaultBlocklist
	}
	list := make([]string, 0, len(base)+len(p.ExtraWords))
	list = append(list, base...)
	list = append(list, p.ExtraWords...)
	seen := make(map[string]bool, len(list))
	out := make([]string, 0, len(list))
	for _, word := range list {
		if !isBlocklistWord(word) {
			return nil, invalidProfile("blocklist entries must be 2 through 32 ASCII letters")
		}
		upper := strings.ToUpper(word)
		if !seen[upper] {
			seen[upper] = true
			out = append(out, upper)
		}
	}
	return out, nil
}

// stripVowels removes AEIOU for no-vowels mode, per spec 18.1. Applied to
// the case-normalized alphabets.
func stripVowels(alphabetNorm string) string {
	return strings.Map(func(r rune) rune {
		switch r {
		case 'A', 'E', 'I', 'O', 'U':
			return -1
		}
		return r
	}, alphabetNorm)
}
