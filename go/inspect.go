package baseh

import (
	"math/big"
	"strings"
)

// InspectState names the as-you-type verdicts of spec 12.5. Values match
// the cross-language specification exactly.
type InspectState string

// Inspect states defined by spec 12.5. There is deliberately no "suggest"
// state: the frozen profiles alias confusable characters during
// normalization.
const (
	InspectEmpty   InspectState = "empty"
	InspectTyping  InspectState = "typing"
	InspectBadChar InspectState = "bad-char"
	InspectTooLong InspectState = "too-long"
	InspectInvalid InspectState = "invalid"
	InspectValid   InspectState = "valid"
)

// InspectResult is the outcome of Inspect. Payload fields are populated
// exactly when the state carries them (spec 12.5.3): Typed and Progress for
// InspectTyping, Reason for InspectInvalid, ID and CanonicalCode for
// InspectValid. InspectEmpty, InspectBadChar and InspectTooLong carry no
// payload.
type InspectResult struct {
	State         InspectState
	Typed         string
	Progress      float64
	Reason        ErrorCode
	ID            *big.Int
	CanonicalCode string
}

// inspectWhitespace is the ASCII whitespace set of spec 12.5.1, dropped
// wherever it appears in the input.
const inspectWhitespace = "\t\n\v\f\r "

// Inspect implements spec 12.5: live as-you-type feedback for a code entry
// field. It gates on the typed length before validating, so the spec-3.4
// re-padding can never paint an incomplete fixed-mode code valid or
// invalid — a short fixed input is InspectTyping, never checked. It never
// returns an error and never panics on user input.
func (h *Codec) Inspect(input string) InspectResult {
	prep := h.prep
	// Step 1: remove every occurrence of the configured separator, then drop
	// ASCII whitespace anywhere (a paste can carry either inside the code).
	s := input
	if prep.profile.Separator != "" {
		s = strings.ReplaceAll(s, prep.profile.Separator, "")
	}
	var cleaned []byte
	for i := 0; i < len(s); i++ {
		if !strings.ContainsRune(inspectWhitespace, rune(s[i])) {
			cleaned = append(cleaned, s[i])
		}
	}
	typed := len(cleaned)
	// Step 2.
	if typed == 0 {
		return InspectResult{State: InspectEmpty}
	}

	// Step 3: the completeness bounds per mode. In expandable mode every
	// length from minLength through 32 is a complete code (the length selects
	// the generation, spec 19.7), so the over-length bound is 32.
	fixed := prep.mode == "fixed"
	expected := 32
	if fixed {
		expected = prep.rawLength
	}
	if typed > expected {
		return InspectResult{State: InspectTooLong}
	}

	// Step 4: spec 3.1 steps 4-6 without any length check and without
	// re-padding — case normalization, direct aliases, then membership in the
	// union of both alphabets. A symbol valid only in the other region passes
	// here and is caught by validate in step 6 as INVALID_CHARACTER.
	raw := make([]byte, typed)
	for i, b := range cleaned {
		if b < 0x80 {
			b = normByte(prep.profile.CaseSensitive, b)
			// A canonical symbol wins over an alias with the same source
			// (spec 3.2); only non-canonical symbols are aliased.
			if prep.allowedByte[b] {
				raw[i] = b
				continue
			}
			if tgt, ok := prep.aliasesNorm[b]; ok {
				raw[i] = tgt
				continue
			}
		}
		return InspectResult{State: InspectBadChar}
	}
	rawStr := string(raw)

	// Step 5: incomplete input reports typing with the normalized symbols
	// separated as far as the groups go, and the fraction toward complete.
	complete := typed >= prep.minLength
	if fixed {
		complete = typed == expected
	}
	if !complete {
		divisor := prep.minLength
		if fixed {
			divisor = expected
		}
		return InspectResult{
			State:    InspectTyping,
			Typed:    formatPartial(rawStr, prep),
			Progress: float64(typed) / float64(divisor),
		}
	}

	// Step 6: judge the normalized string. Interior whitespace and stray
	// separators can never turn a complete code invalid (section 11).
	result := h.Validate(rawStr, nil)
	if !result.Valid {
		return InspectResult{State: InspectInvalid, Reason: result.Reason}
	}
	decoded, err := h.Decode(rawStr, nil)
	if err != nil {
		// Validate just passed on the identical input, so this is
		// unreachable in practice.
		return InspectResult{State: InspectInvalid, Reason: INVALID_PROFILE}
	}
	return InspectResult{State: InspectValid, ID: decoded.ID, CanonicalCode: decoded.CanonicalCode}
}

// formatPartial renders the normalized symbols of a partially typed code
// with separators inserted as far as the groups go (spec 12.5.1 step 5).
// Fixed mode walks the configured grouping, emitting a partial final group
// as-is; expandable mode is bare below separatorMinLength and otherwise
// splits by the balanced grouping rule of spec 19.5 for the typed length.
func formatPartial(raw string, prep *prepared) string {
	sep := prep.profile.Separator
	if sep == "" {
		return raw
	}
	if prep.mode == "expandable" {
		if len(raw) < prep.separatorMinLength {
			return raw
		}
		return joinGroups(raw, expandableGrouping(len(raw)), sep)
	}
	var grouping []int
	offset := 0
	for _, size := range prep.profile.Grouping {
		if offset >= len(raw) {
			break
		}
		if offset+size > len(raw) {
			size = len(raw) - offset
		}
		grouping = append(grouping, size)
		offset += size
	}
	return joinGroups(raw, grouping, sep)
}

// joinGroups splits raw by consecutive group sizes and joins with sep. The
// sizes must cover len(raw) exactly.
func joinGroups(raw string, sizes []int, sep string) string {
	parts := make([]string, 0, len(sizes))
	offset := 0
	for _, size := range sizes {
		parts = append(parts, raw[offset:offset+size])
		offset += size
	}
	return strings.Join(parts, sep)
}
