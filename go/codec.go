package baseh

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

// Codec is a validated, immutable codec bound to one profile. It is safe
// for concurrent use.
type Codec struct {
	prep *prepared
}

// New validates the profile per spec 2.2 and returns a codec ready for
// use. Invalid profiles fail here, at application startup, not on the first
// customer request.
func New(profile Profile) (*Codec, error) {
	prep, err := prepareProfile(profile)
	if err != nil {
		return nil, err
	}
	return &Codec{prep: prep}, nil
}

// Profile returns the profile this codec was built from.
func (h *Codec) Profile() Profile {
	return h.prep.profile
}

// Capacity returns A^bodyLength as a fresh *big.Int. It is fixed-mode
// only (spec 12.3): expandable profiles have no single capacity, so they
// return INVALID_PROFILE; use the per-generation formulas of spec 19.1.
func (h *Codec) Capacity() (*big.Int, error) {
	if h.prep.mode != "fixed" {
		return nil, newError(INVALID_PROFILE, "Capacity is only defined for fixed-mode profiles", false)
	}
	return new(big.Int).Set(h.prep.capacity), nil
}

// Encode implements spec 8 (fixed mode) or spec 19.6 (expandable mode),
// plus the spec-18.2 encode-time blocklist scan.
func (h *Codec) Encode(id *big.Int) (string, error) {
	if h.prep.mode == "expandable" {
		return h.encodeExpandable(id)
	}
	return h.encodeFixed(id)
}

// encodeFixed implements spec 8.
func (h *Codec) encodeFixed(id *big.Int) (string, error) {
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
	if err := h.checkBlocklist(raw); err != nil {
		return "", err
	}
	return formatRaw(raw, h.prep), nil
}

// encodeExpandable implements spec 19.6.
func (h *Codec) encodeExpandable(id *big.Int) (string, error) {
	if id == nil || id.Sign() < 0 {
		return "", newError(OUT_OF_RANGE, fmt.Sprintf("ID %v is negative", id), true)
	}
	l := generationForId(h.prep, id)
	if l > 32 {
		return "", newError(OUT_OF_RANGE, fmt.Sprintf("ID %v requires a code longer than 32 symbols", id), true)
	}
	value := new(big.Int).Sub(id, generationBase(h.prep, l))
	domain := generationCapacity(h.prep, l)
	if h.prep.profile.Permutation.Enabled {
		permuted, err := permute(value, domain, h.permKey(l))
		if err != nil {
			return "", err
		}
		value = permuted
	}
	body := encodeBaseN(value, h.prep.bodyNorm, l-h.prep.profile.ChecksumLength)
	checksum, err := calculateChecksum(h.prep, body)
	if err != nil {
		return "", err
	}
	raw := body + checksum
	if err := h.checkBlocklist(raw); err != nil {
		return "", err
	}
	return formatRaw(raw, h.prep), nil
}

// permKey returns the Feistel key for one generation, with the total code
// length mixed in per spec 7.3/19.4. Fixed mode passes no length.
func (h *Codec) permKey(length int) feistelKey {
	key := h.prep.permutationKey
	if h.prep.mode == "expandable" {
		key.length = length
		key.hasLength = true
	}
	return key
}

// checkBlocklist runs the spec-18.2 case-insensitive substring scan over
// the raw code.
func (h *Codec) checkBlocklist(raw string) error {
	if len(h.prep.blocklist) > 0 {
		upper := strings.ToUpper(raw)
		for _, word := range h.prep.blocklist {
			if strings.Contains(upper, word) {
				return newError(BLOCKED_CODE, "the generated reference contains a blocked substring", false)
			}
		}
	}
	return nil
}

// Decode implements spec 9. All returned errors are *Error.
func (h *Codec) Decode(input string, opts *DecodeOptions) (*DecodeResult, error) {
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

	bodyLength := h.prep.profile.BodyLength
	if h.prep.mode == "expandable" {
		bodyLength = len(raw) - h.prep.profile.ChecksumLength
	}
	body := raw[:bodyLength]
	suppliedChecksum := raw[bodyLength:]

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
		// Spec 10.1: replacements that are not body alphabet symbols are
		// dropped before candidate generation. A suggested symbol the alphabet
		// cannot contain (say a spoken drop on a stripped-alphabet profile)
		// could never validate; generating it anyway would return
		// INVALID_CHARACTER from the checksum step instead of reporting an
		// honest INVALID_CHECKSUM.
		bodySet := make(map[string]bool, len(h.prep.bodyNorm))
		for i := 0; i < len(h.prep.bodyNorm); i++ {
			bodySet[h.prep.bodyNorm[i:i+1]] = true
		}
		filtered := make(map[string][]string, len(confusionMap))
		for source, replacements := range confusionMap {
			var kept []string
			for _, r := range replacements {
				if bodySet[r] {
					kept = append(kept, r)
				}
			}
			if len(kept) > 0 {
				filtered[source] = kept
			}
		}
		candidates, err := generateCandidates(body, filtered, o.MaxCorrections)
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
	if h.prep.mode == "expandable" {
		// Spec 19.7: the offset is de-permuted within the generation's own
		// domain, then the generation base is added back.
		l := len(raw)
		if h.prep.profile.Permutation.Enabled {
			value, err = inversePermute(value, generationCapacity(h.prep, l), h.permKey(l))
			if err != nil {
				return nil, err
			}
		}
		value.Add(generationBase(h.prep, l), value)
	} else if h.prep.profile.Permutation.Enabled {
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
func (h *Codec) Validate(input string, opts *DecodeOptions) ValidateResult {
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
func (h *Codec) normalize(input string, acceptSpaces bool) (string, error) {
	s := strings.Trim(input, "\t\n\v\f\r ")
	hadSeparator := h.prep.profile.Separator != "" && strings.Contains(s, h.prep.profile.Separator)
	if h.prep.profile.Separator != "" {
		s = strings.ReplaceAll(s, h.prep.profile.Separator, "")
	}
	if acceptSpaces {
		s = strings.ReplaceAll(s, " ", "")
	}
	if !h.prep.profile.CaseSensitive {
		s = strings.ToUpper(s)
	}
	// Spec 3.2: an alias never maps two distinct canonical symbols into
	// one value, so a symbol that is already canonical stays as-is and
	// only non-canonical symbols are aliased. (In fixed tiers alias
	// sources are never canonical, so this changes nothing there.)
	if len(h.prep.aliasesNorm) > 0 {
		buf := []byte(s)
		for i := 0; i < len(buf); i++ {
			if buf[i] < 0x80 && h.prep.allowedByte[buf[i]] {
				continue
			}
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
	if h.prep.mode == "expandable" {
		// Spec 19.2/19.7: no left-padding and no stripped-zero leniency.
		// Input shorter than minLength or longer than 32 fails
		// INVALID_LENGTH, and a separator below separatorMinLength is
		// rejected (spec 19.5: the decoder expects no separators there).
		if len(s) < h.prep.minLength {
			return "", newError(INVALID_LENGTH, fmt.Sprintf("expected at least %d symbols, got %d", h.prep.minLength, len(s)), true)
		}
		if len(s) > 32 {
			return "", newError(INVALID_LENGTH, fmt.Sprintf("expected at most 32 symbols, got %d", len(s)), true)
		}
		if hadSeparator && len(s) < h.prep.separatorMinLength {
			return "", newError(INVALID_CHARACTER, fmt.Sprintf("separators do not appear below %d symbols", h.prep.separatorMinLength), true)
		}
		return s, nil
	}
	// Spec 3.4: a code that lost leading zero body symbols is re-padded with
	// the body zero symbol. The checksum symbols always remain, so the split
	// point is unambiguous. A fully stripped no-checksum code would be empty
	// and stays a length error.
	minLength := h.prep.profile.ChecksumLength
	if minLength < 1 {
		minLength = 1
	}
	if len(s) < h.prep.rawLength && len(s) >= minLength {
		s = strings.Repeat(h.prep.bodyNorm[:1], h.prep.rawLength-len(s)) + s
	}
	if len(s) != h.prep.rawLength {
		return "", newError(INVALID_LENGTH, fmt.Sprintf("expected %d symbols, got %d", h.prep.rawLength, len(s)), true)
	}
	return s, nil
}

// formatRaw applies the presentation grouping of spec 11 (fixed mode) or
// the balanced grouping of spec 19.5 (expandable mode). An empty
// separator skips grouping entirely, and expandable codes shorter than
// separatorMinLength render bare.
func formatRaw(raw string, prep *prepared) string {
	if prep.profile.Separator == "" {
		return raw
	}
	grouping := prep.profile.Grouping
	if prep.mode == "expandable" {
		if len(raw) < prep.separatorMinLength {
			return raw
		}
		grouping = expandableGrouping(len(raw))
	}
	parts := make([]string, 0, len(grouping))
	offset := 0
	for _, size := range grouping {
		parts = append(parts, raw[offset:offset+size])
		offset += size
	}
	return strings.Join(parts, prep.profile.Separator)
}

// expandableGrouping implements spec 19.5: the balanced split is a pure
// function of the total length — g = max(2, ceil(L/5)) groups differing in
// size by at most one, larger groups on the left. There is no configurable
// pattern in expandable mode (grouping must be empty, spec 2.2).
func expandableGrouping(length int) []int {
	g := (length + 4) / 5
	if g < 2 {
		g = 2
	}
	base := length / g
	if base < 1 {
		return []int{length}
	}
	rem := length % g
	sizes := make([]int, 0, g)
	for i := 0; i < rem; i++ {
		sizes = append(sizes, base+1)
	}
	for i := 0; i < g-rem; i++ {
		sizes = append(sizes, base)
	}
	return sizes
}

// generationBase implements spec 19.1: the first id of generation L, the
// sum of A^(k-K) for k from minLength through L-1.
func generationBase(prep *prepared, length int) *big.Int {
	a := int64(len(prep.bodyNorm))
	k := prep.profile.ChecksumLength
	base := new(big.Int)
	cap := new(big.Int).Exp(big.NewInt(a), big.NewInt(int64(prep.minLength-k)), nil)
	for l := prep.minLength; l < length; l++ {
		base.Add(base, cap)
		cap.Mul(cap, big.NewInt(a))
	}
	return base
}

// generationCapacity implements spec 19.1: A^(L-K) ids held by
// generation L.
func generationCapacity(prep *prepared, length int) *big.Int {
	return new(big.Int).Exp(
		big.NewInt(int64(len(prep.bodyNorm))),
		big.NewInt(int64(length-prep.profile.ChecksumLength)), nil)
}

// generationForId returns the smallest generation whose range holds id,
// per spec 19.6.
func generationForId(prep *prepared, id *big.Int) int {
	a := big.NewInt(int64(len(prep.bodyNorm)))
	l := prep.minLength
	base := new(big.Int)
	cap := generationCapacity(prep, l)
	sum := new(big.Int)
	for id.Cmp(sum.Add(base, cap)) >= 0 {
		base.Add(base, cap)
		cap.Mul(cap, a)
		l++
	}
	return l
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
