package basehuman

import (
	"errors"
	"fmt"
	"math/big"
	"strings"
)

const maxCandidates = 64

// ConfusionMaps holds the built-in spoken-confusion candidate maps of spec
// 3.3. Pairs apply to body symbols only.
var ConfusionMaps = map[string]map[string][]string{
	"light": {"B": {"D"}, "D": {"B"}, "P": {"T"}, "T": {"P"}},
	"medium": {
		"B": {"D"}, "D": {"B"}, "P": {"T"}, "T": {"P"},
		"M": {"N"}, "N": {"M"}, "V": {"W"}, "W": {"V"},
	},
	"heavy": {
		"B": {"D"}, "D": {"B"}, "P": {"T"}, "T": {"P"},
		"M": {"N"}, "N": {"M"}, "V": {"W"}, "W": {"V"},
		"F": {"S"}, "S": {"F"}, "C": {"G"}, "G": {"C"},
	},
}

// DecodeOptions controls Decode and Validate.
type DecodeOptions struct {
	AcceptSpaces  bool
	TryCorrection bool
	// ConfusionProfile is "none", "light", "medium" or "heavy".
	// The zero value selects "none", the reference default.
	ConfusionProfile string
	// MaxCorrections is 0 or 1 per the spec. The zero value selects 1,
	// the spec default.
	MaxCorrections int
}

// DecodeResult is the successful outcome of Decode.
type DecodeResult struct {
	ID            *big.Int
	CanonicalCode string
	Corrected     bool
}

// ValidateResult is the outcome of Validate. On failure Reason holds the
// error code and no internal ID is exposed.
type ValidateResult struct {
	Valid         bool
	CanonicalCode string
	Reason        ErrorCode
}

// Baseh is a validated, immutable codec bound to one profile. It is safe
// for concurrent use.
type Baseh struct {
	prep *prepared
}

// NewBaseh validates the profile per spec 2.2 and returns a codec ready for
// use. Invalid profiles fail here, at application startup, not on the first
// customer request.
func NewBaseh(profile Profile) (*Baseh, error) {
	prep, err := prepareProfile(profile)
	if err != nil {
		return nil, err
	}
	return &Baseh{prep: prep}, nil
}

// Profile returns the profile this codec was built from.
func (h *Baseh) Profile() Profile {
	return h.prep.profile
}

// Capacity returns A^bodyLength as a fresh *big.Int.
func (h *Baseh) Capacity() *big.Int {
	return new(big.Int).Set(h.prep.capacity)
}

// Encode implements spec 8 plus the spec-18.2 encode-time blocklist scan.
func (h *Baseh) Encode(id *big.Int) (string, error) {
	if id == nil || id.Sign() < 0 || id.Cmp(h.prep.capacity) >= 0 {
		return "", newError(OUT_OF_RANGE, fmt.Sprintf("ID %v is outside the profile capacity", id), true)
	}
	value := new(big.Int).Set(id)
	if h.prep.profile.Permutation.Enabled {
		permuted, err := permute(value, h.prep.capacity, h.prep.permutationKey)
		if err != nil {
			return "", err
		}
		value = permuted
	}
	body := encodeBaseN(value, h.prep.bodyNorm, h.prep.profile.BodyLength)
	checksum, err := calculateChecksum(h.prep, body)
	if err != nil {
		return "", err
	}
	raw := body + checksum
	// Spec 18.2: case-insensitive substring scan over the raw code.
	if len(h.prep.blocklist) > 0 {
		upper := strings.ToUpper(raw)
		for _, word := range h.prep.blocklist {
			if strings.Contains(upper, word) {
				return "", newError(BLOCKED_CODE, "the generated reference contains a blocked substring", false)
			}
		}
	}
	return formatRaw(raw, h.prep), nil
}

// Decode implements spec 9. All returned errors are *Error.
func (h *Baseh) Decode(input string, opts *DecodeOptions) (*DecodeResult, error) {
	o := DecodeOptions{ConfusionProfile: "none", MaxCorrections: 1}
	if opts != nil {
		o = *opts
		if o.ConfusionProfile == "" {
			o.ConfusionProfile = "none"
		}
		// The spec budget is 0 or 1. With a plain int the zero value cannot
		// be distinguished from an explicit 0, so 0 selects the spec default
		// of 1; out-of-range values clamp to 1. Callers disable correction
		// by leaving TryCorrection false.
		if o.MaxCorrections != 1 {
			o.MaxCorrections = 1
		}
	}

	raw, err := h.normalize(input, o.AcceptSpaces)
	if err != nil {
		return nil, err
	}

	body := raw[:h.prep.profile.BodyLength]
	suppliedChecksum := raw[h.prep.profile.BodyLength:]

	// Spec 3.1 validates union membership before the split. There is no
	// per-region membership check: a checksum-region symbol outside the
	// checksum alphabet simply fails as INVALID_CHECKSUM, and a body symbol
	// outside the body alphabet fails in calculateChecksum or decodeBaseN
	// as INVALID_CHARACTER. The frozen error vectors fix this precedence.
	expectedChecksum, err := calculateChecksum(h.prep, body)
	if err != nil {
		return nil, err
	}

	if expectedChecksum != suppliedChecksum {
		if !o.TryCorrection {
			return nil, newError(INVALID_CHECKSUM, "the reference code did not pass validation", true)
		}
		confusionMap, err := resolveConfusionMap(o.ConfusionProfile)
		if err != nil {
			return nil, err
		}
		candidates, err := generateCandidates(body, confusionMap, o.MaxCorrections)
		if err != nil {
			return nil, err
		}
		valid := make(map[string]struct{})
		var only string
		for _, candidate := range candidates {
			candidateChecksum, err := calculateChecksum(h.prep, candidate)
			if err != nil {
				return nil, err
			}
			if candidateChecksum == suppliedChecksum {
				if _, dup := valid[candidate]; !dup {
					valid[candidate] = struct{}{}
					only = candidate
				}
			}
		}
		if len(valid) == 0 {
			return nil, newError(INVALID_CHECKSUM, "the reference code did not pass validation", true)
		}
		if len(valid) > 1 {
			return nil, newError(AMBIGUOUS_INPUT, "the reference code matches more than one record", false)
		}
		body = only
	}

	value, err := decodeBaseN(body, len(h.prep.bodyNorm), h.prep.bodyIndex)
	if err != nil {
		return nil, err
	}
	if h.prep.profile.Permutation.Enabled {
		value, err = inversePermute(value, h.prep.capacity, h.prep.permutationKey)
		if err != nil {
			return nil, err
		}
	}
	canonicalCode, err := h.Encode(value)
	if err != nil {
		return nil, err
	}
	canonicalRaw := strings.ReplaceAll(canonicalCode, h.prep.profile.Separator, "")
	return &DecodeResult{ID: value, CanonicalCode: canonicalCode, Corrected: raw != canonicalRaw}, nil
}

// Validate implements spec 12.4. It never returns an internal ID and never
// returns an error for user input problems; Reason carries the code instead.
func (h *Baseh) Validate(input string, opts *DecodeOptions) ValidateResult {
	result, err := h.Decode(input, opts)
	if err == nil {
		return ValidateResult{Valid: true, CanonicalCode: result.CanonicalCode}
	}
	var herr *Error
	if errors.As(err, &herr) {
		return ValidateResult{Valid: false, Reason: herr.Code}
	}
	// Decode only produces *Error, so this is unreachable in practice.
	return ValidateResult{Valid: false, Reason: INVALID_PROFILE}
}

// normalize implements spec 3.1 steps 1 through 7 and returns the raw
// unformatted string.
func (h *Baseh) normalize(input string, acceptSpaces bool) (string, error) {
	s := strings.Trim(input, "\t\n\v\f\r ")
	if h.prep.profile.Separator != "" {
		s = strings.ReplaceAll(s, h.prep.profile.Separator, "")
	}
	if acceptSpaces {
		s = strings.ReplaceAll(s, " ", "")
	}
	if !h.prep.profile.CaseSensitive {
		s = strings.ToUpper(s)
	}
	if len(h.prep.aliasesNorm) > 0 {
		buf := []byte(s)
		for i := 0; i < len(buf); i++ {
			if tgt, ok := h.prep.aliasesNorm[buf[i]]; ok {
				buf[i] = tgt
			}
		}
		s = string(buf)
	}
	for i := 0; i < len(s); i++ {
		if s[i] > 0x7f || !h.prep.allowedByte[s[i]] {
			return "", newError(INVALID_CHARACTER, fmt.Sprintf("symbol %q is not accepted", string(s[i])), true)
		}
	}
	if len(s) != h.prep.rawLength {
		return "", newError(INVALID_LENGTH, fmt.Sprintf("expected %d symbols, got %d", h.prep.rawLength, len(s)), true)
	}
	return s, nil
}

// formatRaw applies the presentation grouping of spec 11. An empty
// separator skips grouping entirely.
func formatRaw(raw string, prep *prepared) string {
	if prep.profile.Separator == "" {
		return raw
	}
	parts := make([]string, 0, len(prep.profile.Grouping))
	offset := 0
	for _, size := range prep.profile.Grouping {
		parts = append(parts, raw[offset:offset+size])
		offset += size
	}
	return strings.Join(parts, prep.profile.Separator)
}

func resolveConfusionMap(name string) (map[string][]string, error) {
	if name == "none" {
		return map[string][]string{}, nil
	}
	m, ok := ConfusionMaps[name]
	if !ok {
		return nil, newError(INVALID_PROFILE, fmt.Sprintf("unknown confusion profile %q", name), false)
	}
	return m, nil
}

// generateCandidates implements spec 10: substitution-only candidates,
// deduplicated and capped at 64.
func generateCandidates(body string, confusionMap map[string][]string, maxEdits int) ([]string, error) {
	if maxEdits == 0 {
		return nil, nil
	}
	seen := make(map[string]struct{})
	var results []string
	for pos := 0; pos < len(body); pos++ {
		source := string(body[pos])
		for _, replacement := range confusionMap[source] {
			candidate := []byte(body)
			candidate[pos] = replacement[0]
			s := string(candidate)
			if _, dup := seen[s]; dup {
				continue
			}
			seen[s] = struct{}{}
			results = append(results, s)
			if len(results) > maxCandidates {
				return nil, newError(TOO_MANY_CANDIDATES, "candidate generation exceeded 64 entries", false)
			}
		}
	}
	return results, nil
}
