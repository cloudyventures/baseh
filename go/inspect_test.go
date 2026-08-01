package baseh

import (
	"math/big"
	"strings"
	"testing"
)

func mustCodec(t *testing.T, p Profile) *Codec {
	t.Helper()
	h, err := New(p)
	if err != nil {
		t.Fatalf("New(%s): %v", p.ProfileID, err)
	}
	return h
}

func TestInspectFixedEmpty(t *testing.T) {
	medium := mustCodec(t, MediumV1())
	for _, input := range []string{"", "   ", " - \t"} {
		if r := medium.Inspect(input); r.State != InspectEmpty {
			t.Errorf("Inspect(%q).State = %s, want %s", input, r.State, InspectEmpty)
		}
	}
}

func TestInspectFixedTypingPrefixes(t *testing.T) {
	medium := mustCodec(t, MediumV1())
	canonical, err := medium.Encode(big.NewInt(123456789))
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	raw := strings.ReplaceAll(canonical, "-", "")
	for n := 1; n < 8; n++ {
		r := medium.Inspect(raw[:n])
		if r.State != InspectTyping {
			t.Fatalf("prefix %d: state = %s, want %s", n, r.State, InspectTyping)
		}
		if got := strings.ReplaceAll(r.Typed, "-", ""); got != raw[:n] {
			t.Errorf("prefix %d: typed = %q, want symbols %q", n, r.Typed, raw[:n])
		}
		if want := float64(n) / 8; r.Progress != want {
			t.Errorf("prefix %d: progress = %v, want %v", n, r.Progress, want)
		}
	}
	// Separators inserted as far as the groups go (grouping [4, 4]).
	r := medium.Inspect(raw[:5])
	if r.State != InspectTyping || r.Typed != raw[:4]+"-"+raw[4:5] {
		t.Errorf("typed = %q (%s), want %q", r.Typed, r.State, raw[:4]+"-"+raw[4:5])
	}
}

func TestInspectFixedTypingNormalizesCaseAndAliases(t *testing.T) {
	medium := mustCodec(t, MediumV1())
	canonical, err := medium.Encode(big.NewInt(123456789))
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	raw := strings.ReplaceAll(canonical, "-", "")
	lower := medium.Inspect(strings.ToLower(raw[:5]))
	if lower.State != InspectTyping || lower.Typed != raw[:4]+"-"+raw[4:5] {
		t.Errorf("lowercase typed = %q (%s), want %q", lower.Typed, lower.State, raw[:4]+"-"+raw[4:5])
	}
	// Alias sources typed mid-code normalize to their targets (O -> 0 etc.).
	cloneProfile := MediumV1()
	cloneProfile.Permutation = Permutation{}
	cloneProfile.Profanity = Profanity{}
	cloneProfile.MaxRepetition = 0
	clone := mustCodec(t, cloneProfile)
	aliased := clone.Inspect("OIL")
	if aliased.State != InspectTyping || aliased.Typed != "011" {
		t.Errorf("aliased typed = %q (%s), want %q", aliased.Typed, aliased.State, "011")
	}
}

func TestInspectFixedTypingIgnoresWhitespaceAndSeparators(t *testing.T) {
	medium := mustCodec(t, MediumV1())
	canonical, err := medium.Encode(big.NewInt(123456789))
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	raw := strings.ReplaceAll(canonical, "-", "")
	messy := " " + raw[:2] + " -" + raw[2:5] + "\t"
	r := medium.Inspect(messy)
	if r.State != InspectTyping {
		t.Fatalf("state = %s, want %s", r.State, InspectTyping)
	}
	if got := strings.ReplaceAll(r.Typed, "-", ""); got != raw[:5] {
		t.Errorf("typed = %q, want symbols %q", r.Typed, raw[:5])
	}
}

func TestInspectFixedPaddedPrefixStillTyping(t *testing.T) {
	// Spec 3.4: find a short input whose re-padded form validates (the
	// cookbook's "false green"), on a filter-free clone so the scan is not
	// disturbed by the blocklist or repetition filter. inspect must still
	// report typing for it.
	cloneProfile := MediumV1()
	cloneProfile.Profanity = Profanity{}
	cloneProfile.MaxRepetition = 0
	clone := mustCodec(t, cloneProfile)
	medium := mustCodec(t, MediumV1())
	found := ""
	for id := int64(0); id < 200000 && found == ""; id++ {
		code, err := clone.Encode(big.NewInt(id))
		if err != nil {
			t.Fatalf("Encode(%d): %v", id, err)
		}
		raw := strings.ReplaceAll(code, "-", "")
		stripped := strings.TrimLeft(raw, "0")
		if stripped == "" {
			stripped = raw[len(raw)-1:]
		}
		if len(stripped) < len(raw) && len(stripped) >= 2 && clone.Validate(stripped, nil).Valid {
			found = stripped
		}
	}
	if found == "" {
		t.Fatal("no false-green prefix found in scan window")
	}
	if r := medium.Inspect(found); r.State != InspectTyping {
		t.Errorf("Inspect(%q).State = %s, want %s", found, r.State, InspectTyping)
	}
}

func TestInspectFixedValid(t *testing.T) {
	medium := mustCodec(t, MediumV1())
	canonical, err := medium.Encode(big.NewInt(123456789))
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	r := medium.Inspect(canonical)
	if r.State != InspectValid || r.ID.Cmp(big.NewInt(123456789)) != 0 || r.CanonicalCode != canonical {
		t.Fatalf("Inspect(%q) = %+v, want valid id 123456789 code %q", canonical, r, canonical)
	}
	// No separators, lowercase, surrounding whitespace all reach valid.
	messy := " " + strings.ToLower(strings.ReplaceAll(canonical, "-", "")) + " "
	r2 := medium.Inspect(messy)
	if r2.State != InspectValid || r2.ID.Cmp(r.ID) != 0 || r2.CanonicalCode != r.CanonicalCode {
		t.Errorf("Inspect(%q) = %+v, want %+v", messy, r2, r)
	}
}

func TestInspectFixedAliasTypedCompleteCode(t *testing.T) {
	cloneProfile := MediumV1()
	cloneProfile.Profanity = Profanity{}
	cloneProfile.MaxRepetition = 0
	clone := mustCodec(t, cloneProfile)
	for id := int64(1); id < 100000; id++ {
		code, err := clone.Encode(big.NewInt(id))
		if err != nil {
			t.Fatalf("Encode(%d): %v", id, err)
		}
		raw := strings.ReplaceAll(code, "-", "")
		if strings.Contains(raw, "8") {
			r := clone.Inspect(strings.Replace(raw, "8", "B", 1)) // B -> 8
			if r.State != InspectValid || r.ID.Cmp(big.NewInt(id)) != 0 {
				t.Fatalf("Inspect(B-typed %q) = %+v, want valid id %d", raw, r, id)
			}
			return
		}
	}
	t.Fatal("no code containing 8 found")
}

func TestInspectFixedInvalidChecksum(t *testing.T) {
	medium := mustCodec(t, MediumV1())
	canonical, err := medium.Encode(big.NewInt(77))
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	raw := []byte(strings.ReplaceAll(canonical, "-", ""))
	if raw[6] == '2' {
		raw[6] = '3'
	} else {
		raw[6] = '2'
	}
	r := medium.Inspect(string(raw))
	if r.State != InspectInvalid || r.Reason != INVALID_CHECKSUM {
		t.Errorf("Inspect(%q) = %+v, want invalid %s", raw, r, INVALID_CHECKSUM)
	}
}

func TestInspectFixedBadChar(t *testing.T) {
	medium := mustCodec(t, MediumV1())
	for _, input := range []string{"12@", "1234-56@8"} {
		if r := medium.Inspect(input); r.State != InspectBadChar {
			t.Errorf("Inspect(%q).State = %s, want %s", input, r.State, InspectBadChar)
		}
	}
}

func TestInspectChecksumOnlySymbolInBodyIsInvalid(t *testing.T) {
	// U is in the Heavy checksum alphabet but not its body alphabet: it
	// passes the union-membership gate and fails under validate, exactly
	// like the shared error vector (heavy "U00000A" -> INVALID_CHARACTER).
	heavy := mustCodec(t, HeavyV1())
	r := heavy.Inspect("U000000A")
	if r.State != InspectInvalid || r.Reason != INVALID_CHARACTER {
		t.Errorf("Inspect = %+v, want invalid %s", r, INVALID_CHARACTER)
	}
}

func TestInspectFixedTooLong(t *testing.T) {
	medium := mustCodec(t, MediumV1())
	for _, input := range []string{"00000000C", "0000-0000-C"} {
		if r := medium.Inspect(input); r.State != InspectTooLong {
			t.Errorf("Inspect(%q).State = %s, want %s", input, r.State, InspectTooLong)
		}
	}
}

func TestInspectFixedNoChecksumProfile(t *testing.T) {
	minimum := mustCodec(t, MinimumV1())
	canonical, err := minimum.Encode(big.NewInt(42))
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	if r := minimum.Inspect(canonical); r.State != InspectValid {
		t.Errorf("Inspect(%q).State = %s, want %s", canonical, r.State, InspectValid)
	}
	if r := minimum.Inspect(canonical[:3]); r.State != InspectTyping {
		t.Errorf("prefix state = %s, want %s", r.State, InspectTyping)
	}
}

func TestInspectExpandableEmptyAndTyping(t *testing.T) {
	expandable := mustCodec(t, ExpandableV1())
	if r := expandable.Inspect(""); r.State != InspectEmpty {
		t.Errorf("empty: state = %s", r.State)
	}
	cases := []struct {
		input    string
		typed    string
		progress float64
	}{
		{"1", "1", 0.25},
		{"12", "12", 0.5},
		{"123", "123", 0.75},
		{"ab", "AB", 0.5}, // below separatorMinLength the typing render is bare
		{"O", "0", 0.25},  // alias O -> 0; 0 is a checksum-alphabet symbol
	}
	for _, c := range cases {
		r := expandable.Inspect(c.input)
		if r.State != InspectTyping || r.Typed != c.typed || r.Progress != c.progress {
			t.Errorf("Inspect(%q) = %+v, want typing %q progress %v", c.input, r, c.typed, c.progress)
		}
	}
}

func TestInspectExpandableGenerationBoundaries(t *testing.T) {
	expandable := mustCodec(t, ExpandableV1())
	for _, id := range []int64{0, 39304, 1375640} {
		code, err := expandable.Encode(big.NewInt(id))
		if err != nil {
			t.Fatalf("Encode(%d): %v", id, err)
		}
		r := expandable.Inspect(code)
		if r.State != InspectValid || r.ID.Cmp(big.NewInt(id)) != 0 || r.CanonicalCode != code {
			t.Errorf("Inspect(%q) = %+v, want valid id %d code %q", code, r, id, code)
		}
	}
}

func TestInspectExpandableCompleteLengthsAreNeverTyping(t *testing.T) {
	expandable := mustCodec(t, ExpandableV1())
	code, err := expandable.Encode(big.NewInt(777)) // generation 4
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	raw := strings.ReplaceAll(code, "-", "")
	five := raw + "A" // wrong-length presentation, checksum fails (spec 19.7)
	r := expandable.Inspect(five)
	if r.State != InspectInvalid || r.Reason != INVALID_CHECKSUM {
		t.Errorf("Inspect(%q) = %+v, want invalid %s", five, r, INVALID_CHECKSUM)
	}
}

func TestInspectExpandableZeroInBodyPosition(t *testing.T) {
	expandable := mustCodec(t, ExpandableV1())
	code, err := expandable.Encode(big.NewInt(777))
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	raw := strings.ReplaceAll(code, "-", "")
	for _, bad := range []string{"0" + raw[1:], "O" + raw[1:]} {
		r := expandable.Inspect(bad)
		if r.State != InspectInvalid || r.Reason != INVALID_CHARACTER {
			t.Errorf("Inspect(%q) = %+v, want invalid %s", bad, r, INVALID_CHARACTER)
		}
	}
}

func TestInspectExpandableBadCharAndTooLong(t *testing.T) {
	expandable := mustCodec(t, ExpandableV1())
	for _, input := range []string{"A@", "ABCD@"} {
		if r := expandable.Inspect(input); r.State != InspectBadChar {
			t.Errorf("Inspect(%q).State = %s, want %s", input, r.State, InspectBadChar)
		}
	}
	if r := expandable.Inspect(strings.Repeat("A", 33)); r.State != InspectTooLong {
		t.Errorf("33 symbols: state = %s, want %s", r.State, InspectTooLong)
	}
	// 32 real symbols pass the length gate and land on validate.
	if r := expandable.Inspect(strings.Repeat("A", 32)); r.State != InspectInvalid {
		t.Errorf("32 symbols: state = %s, want %s", r.State, InspectInvalid)
	}
}

func TestInspectExpandableMessyCompleteCode(t *testing.T) {
	expandable := mustCodec(t, ExpandableV1())
	code, err := expandable.Encode(big.NewInt(1375640))
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	raw := strings.ReplaceAll(code, "-", "")
	r := expandable.Inspect(" " + raw[:3] + " - " + raw[3:])
	if r.State != InspectValid || r.ID.Cmp(big.NewInt(1375640)) != 0 || r.CanonicalCode != code {
		t.Errorf("Inspect = %+v, want valid id 1375640 code %q", r, code)
	}
}

func TestInspectFacadeMatchesInstance(t *testing.T) {
	expandable := mustCodec(t, ExpandableV1())
	code, err := expandable.Encode(big.NewInt(42))
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	for _, input := range []string{"", "1", "AB@", strings.Repeat("A", 33), code} {
		facade := Inspect(input)
		instance := expandable.Inspect(input)
		if facade.State != instance.State ||
			facade.Typed != instance.Typed ||
			facade.Progress != instance.Progress ||
			facade.Reason != instance.Reason ||
			facade.CanonicalCode != instance.CanonicalCode ||
			(facade.ID == nil) != (instance.ID == nil) ||
			(facade.ID != nil && facade.ID.Cmp(instance.ID) != 0) {
			t.Errorf("Inspect(%q): facade %+v != instance %+v", input, facade, instance)
		}
	}
	if r := Inspect(code); r.State != InspectValid {
		t.Errorf("facade Inspect(%q).State = %s, want %s", code, r.State, InspectValid)
	}
}
