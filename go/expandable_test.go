package baseh

import (
	"errors"
	"math/big"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
)

// customExpandable returns an expandable profile with no permutation and
// no blocklist; overrides mutate a copy.
func customExpandable(f func(*Profile)) Profile {
	p := Profile{
		ProfileID:          "custom-expandable-test",
		Mode:               "expandable",
		BodyAlphabet:       "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", // 0/O stripped at preparation
		MinLength:          3,
		ChecksumAlphabet:   "",
		ChecksumLength:     1,
		CaseSensitive:      false,
		Separator:          "",
		SeparatorMinLength: 0,
		Grouping:           nil,
		Aliases:            map[string]string{"O": "0", "I": "1", "L": "1"},
		Permutation:        Permutation{Enabled: false},
	}
	if f != nil {
		f(&p)
	}
	return p
}

func rawCode(code string) string {
	return strings.ReplaceAll(code, "-", "")
}

// encodeOrSkip encodes and reports (code, true); blocklisted ids are
// reserved and never issued (spec 18), so they report ("", false).
func encodeOrSkip(t *testing.T, h *Codec, id *big.Int) (string, bool) {
	t.Helper()
	code, err := h.Encode(id)
	if err != nil {
		var herr *Error
		if errors.As(err, &herr) && herr.Code == BLOCKED_CODE {
			return "", false
		}
		t.Fatalf("encode %s: %v", id, err)
	}
	return code, true
}

func TestExpandableFrozenTierShape(t *testing.T) {
	h := mustNew(t, ExpandableV1())
	if h.prep.bodyNorm != "123456789ACDEFGHJKMPQRUVXYZ" {
		t.Errorf("body alphabet = %q", h.prep.bodyNorm)
	}
	if len(h.prep.bodyNorm) != 27 {
		t.Errorf("body alphabet length = %d", len(h.prep.bodyNorm))
	}
	if h.prep.checksumNorm != "0123456789ACDEFGHJKMPQRUVXYZ" {
		t.Errorf("checksum alphabet = %q", h.prep.checksumNorm)
	}
	if len(h.prep.checksumNorm) != 28 {
		t.Errorf("checksum alphabet length = %d", len(h.prep.checksumNorm))
	}
	if h.prep.checksumModulus.String() != "784" {
		t.Errorf("checksum modulus = %s", h.prep.checksumModulus)
	}
	if h.prep.mode != "expandable" || h.prep.minLength != 4 || h.prep.separatorMinLength != 6 {
		t.Errorf("mode/minLength/separatorMinLength = %q/%d/%d",
			h.prep.mode, h.prep.minLength, h.prep.separatorMinLength)
	}

	// The generation table of spec 17.1/22.5: the short checksum (1 symbol
	// through total length 5) buys generation 4 a third body symbol, and
	// generation 6's extra symbol buys back the second checksum symbol.
	expected := []struct {
		length   int
		base     string
		capacity string
	}{
		{4, "0", "19683"},
		{5, "19683", "531441"},
		{6, "551124", "531441"},
		{7, "1082565", "14348907"},
		{8, "15431472", "387420489"},
	}
	for _, e := range expected {
		if got := generationBase(h.prep, e.length).String(); got != e.base {
			t.Errorf("generationBase(%d) = %s, want %s", e.length, got, e.base)
		}
		if got := generationCapacity(h.prep, e.length).String(); got != e.capacity {
			t.Errorf("generationCapacity(%d) = %s, want %s", e.length, got, e.capacity)
		}
	}

	// Capacity is fixed-mode only (spec 12.3).
	if _, err := h.Capacity(); err == nil {
		t.Errorf("Capacity on an expandable profile succeeded")
	} else {
		assertCode(t, err, INVALID_PROFILE)
	}
}

func TestExpandableBoundaryRoundTrips(t *testing.T) {
	h := mustNew(t, ExpandableV1())

	for l := 4; l <= 8; l++ {
		base := generationBase(h.prep, l)
		next := generationBase(h.prep, l+1)
		for _, id := range []*big.Int{base, new(big.Int).Sub(next, big.NewInt(1)), next} {
			code, ok := encodeOrSkip(t, h, id)
			if !ok {
				continue
			}
			if got := len(rawCode(code)); got != generationForId(h.prep, id) {
				t.Errorf("id %s encoded at length %d, want generation %d", id, got, generationForId(h.prep, id))
			}
			res, err := h.Decode(code, nil)
			if err != nil {
				t.Fatalf("decode %q: %v", code, err)
			}
			if res.ID.Cmp(id) != 0 || res.CanonicalCode != code || res.Corrected {
				t.Errorf("round trip %s -> %q -> %+v", id, code, res)
			}
			// The zero ban makes a non-zero leading body symbol structural.
			if first := rawCode(code)[0]; first == '0' || first == 'O' {
				t.Errorf("code %q starts with %c", code, first)
			}
		}
	}

	if got := len(rawCode(mustEncode(t, h, 19682))); got != 4 {
		t.Errorf("id 19682 length = %d, want 4", got)
	}
	if got := len(rawCode(mustEncode(t, h, 19683))); got != 5 {
		t.Errorf("id 19683 length = %d, want 5", got)
	}

	// Exhaustively round-trip every issuable id of generation 4.
	issued := 0
	for id := int64(0); id < 19683; id++ {
		code, ok := encodeOrSkip(t, h, big.NewInt(id))
		if !ok {
			continue
		}
		if len(rawCode(code)) != 4 {
			t.Errorf("id %d encoded at length %d, want 4", id, len(rawCode(code)))
		}
		res, err := h.Decode(code, nil)
		if err != nil || res.ID.Int64() != id {
			t.Errorf("round trip %d -> %q -> %+v, %v", id, code, res, err)
		}
		issued++
	}
	if issued <= 19000 {
		t.Errorf("expected nearly all 19683 ids issuable, got %d", issued)
	}
}

func mustEncode(t *testing.T, h *Codec, id int64) string {
	t.Helper()
	code, err := h.Encode(big.NewInt(id))
	if err != nil {
		t.Fatalf("encode %d: %v", id, err)
	}
	return code
}

func TestExpandableCustomBoundaryRoundTrips(t *testing.T) {
	c := mustNew(t, customExpandable(nil))
	// minLength 3, checksum 1, body 34: generation 3 holds 34^2 = 1156 ids.
	if generationBase(c.prep, 3).Sign() != 0 {
		t.Errorf("generationBase(3) != 0")
	}
	if generationBase(c.prep, 4).String() != "1156" {
		t.Errorf("generationBase(4) = %s, want 1156", generationBase(c.prep, 4))
	}
	for _, id := range []int64{0, 1, 1155, 1156, 40459, 40460} {
		code := mustEncode(t, c, id)
		res, err := c.Decode(code, nil)
		if err != nil || res.ID.Int64() != id {
			t.Errorf("round trip %d -> %q -> %+v, %v", id, code, res, err)
		}
	}
	if got := len(mustEncode(t, c, 1155)); got != 3 {
		t.Errorf("id 1155 length = %d, want 3", got)
	}
	if got := len(mustEncode(t, c, 1156)); got != 4 {
		t.Errorf("id 1156 length = %d, want 4", got)
	}
}

func TestExpandableZeroBan(t *testing.T) {
	h := mustNew(t, ExpandableV1())

	code := rawCode(mustEncode(t, h, 1000))
	if _, err := h.Decode("0"+code[1:], nil); err == nil {
		t.Errorf("presented 0 in a body position decoded")
	} else {
		assertCode(t, err, INVALID_CHARACTER)
	}
	if _, err := h.Decode("O"+code[1:], nil); err == nil {
		t.Errorf("presented O in a body position decoded")
	} else {
		assertCode(t, err, INVALID_CHARACTER)
	}

	// A custom alphabet containing 0 and O is silently stripped.
	prep, err := prepareProfile(customExpandable(nil))
	if err != nil {
		t.Fatalf("prepareProfile: %v", err)
	}
	if strings.ContainsAny(prep.bodyNorm, "0O") {
		t.Errorf("body alphabet keeps 0/O: %q", prep.bodyNorm)
	}
	if prep.bodyNorm != "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ" {
		t.Errorf("body alphabet = %q", prep.bodyNorm)
	}

	// The strip must not leave fewer than two symbols.
	if _, err := New(customExpandable(func(p *Profile) { p.BodyAlphabet = "0O" })); err == nil {
		t.Errorf("0/O-only body alphabet accepted")
	} else {
		assertCode(t, err, INVALID_PROFILE)
	}
}

func TestExpandableChecksumWithZero(t *testing.T) {
	h := mustNew(t, ExpandableV1())

	type pair struct {
		id   *big.Int
		code string
	}
	var found []pair
	for id := int64(0); id < 200000 && len(found) < 8; id++ {
		code, ok := encodeOrSkip(t, h, big.NewInt(id))
		if !ok {
			continue
		}
		if strings.Contains(rawCode(code)[len(rawCode(code))-2:], "0") {
			found = append(found, pair{big.NewInt(id), code})
		}
	}
	if len(found) < 8 {
		t.Fatalf("expected checksum-with-zero codes in the sample, got %d", len(found))
	}
	for _, p := range found {
		res, err := h.Decode(p.code, nil)
		if err != nil || res.ID.Cmp(p.id) != 0 || res.CanonicalCode != p.code {
			t.Errorf("round trip %s -> %q -> %+v, %v", p.id, p.code, res, err)
		}
	}

	// Typed O in a checksum position aliases to 0 and decodes to the same
	// id. Aliased input is not a correction: spec 9 defines corrected as
	// canonicalize(input) != canonicalize(canonical), and canonicalize
	// applies aliases. The fixed-mode tests pin the same behaviour.
	var pinned *pair
	for id := int64(0); id < 500000 && pinned == nil; id++ {
		code, ok := encodeOrSkip(t, h, big.NewInt(id))
		if !ok {
			continue
		}
		if strings.HasSuffix(rawCode(code), "0") {
			pinned = &pair{big.NewInt(id), code}
		}
	}
	if pinned == nil {
		t.Fatalf("expected a code whose checksum ends in 0")
	}
	r := rawCode(pinned.code)
	typed := r[:len(r)-1] + "O"
	res, err := h.Decode(typed, nil)
	if err != nil {
		t.Fatalf("decode %q: %v", typed, err)
	}
	if res.ID.Cmp(pinned.id) != 0 || res.CanonicalCode != pinned.code || res.Corrected {
		t.Errorf("typed O round trip = %+v, want id %s code %q corrected false", res, pinned.id, pinned.code)
	}
}

func TestExpandableChecksumDetection(t *testing.T) {
	// At each generation M = S^effectiveK. Single-substitution detection is
	// total at every generation: 37 is coprime to both 28 and 784, so a
	// non-zero delta can never leave the checksum unchanged. Transposition
	// detection is total only at M=784 (gen 6+): gcd(36,784)=4, but the
	// escape needs 196|(a-b), impossible for |a-b|<=26. At gen 4-5 (M=28)
	// adjacent values differing by a multiple of 7 can escape, so the
	// transposition sweep is pinned at generations 6 and 8 only (spec
	// 17.1/22.4).
	h := mustNew(t, ExpandableV1())
	for _, l := range []int{4, 6, 8} {
		k := effectiveChecksumLength(h.prep, l)
		base := generationBase(h.prep, l)
		bodyLen := l - k
		subMisses := 0
		transMisses := 0
		for i := int64(0); i < 50; i++ {
			code, ok := encodeOrSkip(t, h, new(big.Int).Add(base, big.NewInt(i)))
			if !ok {
				continue
			}
			body := rawCode(code)[:bodyLen]
			before, err := checksumValue(h.prep, body, k)
			if err != nil {
				t.Fatalf("checksumValue: %v", err)
			}
			for pos := 0; pos < bodyLen; pos++ {
				cur := h.prep.bodyIndex[body[pos]]
				for _, delta := range []int64{1, 5, 17} {
					nv := (cur + delta) % int64(len(h.prep.bodyNorm))
					candidate := body[:pos] + string(h.prep.bodyNorm[nv]) + body[pos+1:]
					got, err := checksumValue(h.prep, candidate, k)
					if err != nil {
						t.Fatalf("checksumValue: %v", err)
					}
					if got.Cmp(before) == 0 {
						subMisses++
					}
				}
			}
			if l >= 6 {
				for pos := 0; pos+1 < bodyLen; pos++ {
					if body[pos] == body[pos+1] {
						continue
					}
					swapped := body[:pos] + string(body[pos+1]) + string(body[pos]) + body[pos+2:]
					got, err := checksumValue(h.prep, swapped, k)
					if err != nil {
						t.Fatalf("checksumValue: %v", err)
					}
					if got.Cmp(before) == 0 {
						transMisses++
					}
				}
			}
		}
		if subMisses != 0 {
			t.Errorf("generation %d had %d single-substitution misses", l, subMisses)
		}
		if l >= 6 && transMisses != 0 {
			t.Errorf("generation %d had %d transposition misses", l, transMisses)
		}
	}
}

func TestExpandableNoLeftPadding(t *testing.T) {
	h := mustNew(t, ExpandableV1())

	for _, input := range []string{"1", "ABC", ""} {
		if _, err := h.Decode(input, nil); err == nil {
			t.Errorf("decode %q succeeded", input)
		} else {
			assertCode(t, err, INVALID_LENGTH)
		}
	}
	if _, err := h.Decode(strings.Repeat("A", 33), nil); err == nil {
		t.Errorf("33-symbol input decoded")
	} else {
		assertCode(t, err, INVALID_LENGTH)
	}

	// canonicalCode always has exactly the presented length.
	for _, id := range []int64{0, 19682, 19683, 551124, 123456789} {
		code := mustEncode(t, h, id)
		res, err := h.Decode(code, nil)
		if err != nil {
			t.Fatalf("decode %q: %v", code, err)
		}
		if len(rawCode(res.CanonicalCode)) != len(rawCode(code)) {
			t.Errorf("canonical %q length differs from %q", res.CanonicalCode, code)
		}
	}
}

func TestExpandableSeparatorThreshold(t *testing.T) {
	h := mustNew(t, ExpandableV1())

	if strings.Contains(mustEncode(t, h, 0), "-") {
		t.Errorf("length-4 code contains a separator")
	}
	if strings.Contains(mustEncode(t, h, 19683), "-") {
		t.Errorf("length-5 code contains a separator")
	}

	// The decoder rejects a separator below separatorMinLength.
	code := mustEncode(t, h, 0)
	withHyphen := code[:2] + "-" + code[2:]
	if _, err := h.Decode(withHyphen, nil); err == nil {
		t.Errorf("decode %q succeeded", withHyphen)
	} else {
		assertCode(t, err, INVALID_CHARACTER)
	}

	// The pinned shapes for lengths 6 through 10.
	shapes := map[int]string{
		6:  `^...-...$`,
		7:  `^....-...$`,
		8:  `^....-....$`,
		9:  `^.....-....$`,
		10: `^.....-.....$`,
	}
	for l, shape := range shapes {
		re := regexp.MustCompile(shape)
		base := generationBase(h.prep, l)
		var code string
		for probe := int64(0); probe < 5000 && code == ""; probe++ {
			if c, ok := encodeOrSkip(t, h, new(big.Int).Add(base, big.NewInt(probe))); ok {
				code = c
			}
		}
		if code == "" {
			t.Fatalf("no issuable id found at generation %d", l)
		}
		if !re.MatchString(code) {
			t.Errorf("generation %d: %q does not match %s", l, code, shape)
		}
		res, err := h.Decode(code, nil)
		if err != nil || res.CanonicalCode != code {
			t.Errorf("round trip %q -> %+v, %v", code, res, err)
		}
	}
}

func TestExpandableGroupingBalanced(t *testing.T) {
	// The pinned shapes of spec 19.5.
	cases := []struct {
		length int
		want   []int
	}{
		{4, []int{2, 2}},
		{5, []int{3, 2}},
		{6, []int{3, 3}},
		{7, []int{4, 3}},
		{8, []int{4, 4}},
		{9, []int{5, 4}},
		{10, []int{5, 5}},
		{11, []int{4, 4, 3}},
		{12, []int{4, 4, 4}},
		{13, []int{5, 4, 4}},
		{14, []int{5, 5, 4}},
		{15, []int{5, 5, 5}},
		{16, []int{4, 4, 4, 4}},
	}
	for _, c := range cases {
		if got := expandableGrouping(c.length); !reflect.DeepEqual(got, c.want) {
			t.Errorf("expandableGrouping(%d) = %v, want %v", c.length, got, c.want)
		}
	}
}

func TestExpandableWrongGenerationRejection(t *testing.T) {
	h := mustNew(t, ExpandableV1())

	code := rawCode(mustEncode(t, h, 777))
	if len(code) != 4 {
		t.Fatalf("id 777 encoded at length %d, want 4", len(code))
	}
	for _, extra := range []string{"1", "A", "Z"} {
		longer := code + extra // 5 symbols: body split moves, checksum fails
		result := h.Validate(longer, nil)
		if result.Valid {
			t.Fatalf("validate %q succeeded", longer)
		}
		if result.Reason != INVALID_CHECKSUM && result.Reason != INVALID_CHARACTER {
			t.Errorf("validate %q reason = %s", longer, result.Reason)
		}
		if _, err := h.Decode(longer, nil); err == nil {
			t.Errorf("decode %q succeeded", longer)
		} else {
			assertCode(t, err, result.Reason)
		}
	}

	gen6 := rawCode(mustEncode(t, h, 551124))
	if result := h.Validate(gen6[1:], nil); result.Valid {
		t.Errorf("validate %q succeeded", gen6[1:])
	}

	// Correction never returns a candidate at a different length. C and G
	// are confusable under the heavy map and both survive in the 27-symbol
	// body alphabet; find a code containing one in the body.
	var code8 string
	var foundID int64
	for probe := int64(0); probe < 5000000; probe++ {
		c, ok := encodeOrSkip(t, h, big.NewInt(probe))
		if !ok {
			continue
		}
		r := rawCode(c)
		for pos := 0; pos < len(r)-2; pos++ {
			if r[pos] == 'C' || r[pos] == 'G' {
				code8 = c
				foundID = probe
				break
			}
		}
		if code8 != "" {
			break
		}
	}
	if code8 == "" {
		t.Skip("no C/G body symbol in range")
	}
	r := rawCode(code8)
	pairs := map[byte]byte{'C': 'G', 'G': 'C'}
	typo := ""
	for pos := 0; pos < len(r)-2 && typo == ""; pos++ {
		if repl, ok := pairs[r[pos]]; ok {
			typo = r[:pos] + string(repl) + r[pos+1:]
		}
	}
	if typo == "" {
		t.Fatalf("expected a confusable body symbol in %q", r)
	}
	res, err := h.Decode(typo, &DecodeOptions{TryCorrection: true, ConfusionProfile: "heavy"})
	if err != nil {
		t.Fatalf("decode %q: %v", typo, err)
	}
	if len(rawCode(res.CanonicalCode)) != len(r) || res.ID.Int64() != foundID {
		t.Errorf("correction = %+v, want id %d at length %d", res, foundID, len(r))
	}
}

func TestExpandableKeyedTier(t *testing.T) {
	p := mustNew(t, ExpandablePV1(testKey, "test-01", 0))
	if p.prep.profile.ProfileID != "baseh-expandable-p-v1" {
		t.Errorf("profile id = %q", p.prep.profile.ProfileID)
	}
	ids := []*big.Int{
		big.NewInt(0), big.NewInt(1), big.NewInt(728), big.NewInt(729),
		big.NewInt(20412), big.NewInt(123456789), generationBase(p.prep, 9),
	}
	for _, id := range ids {
		code, ok := encodeOrSkip(t, p, id)
		if !ok {
			continue
		}
		res, err := p.Decode(code, nil)
		if err != nil || res.ID.Cmp(id) != 0 {
			t.Errorf("round trip %s -> %q -> %+v, %v", id, code, res, err)
		}
	}

	// Custom rounds are honoured.
	p4 := mustNew(t, ExpandablePV1(testKey, "test-01", 4))
	p8 := mustNew(t, ExpandablePV1(testKey, "test-01", 8))
	c4 := mustEncode(t, p4, 42)
	res, err := p4.Decode(c4, nil)
	if err != nil || res.ID.Int64() != 42 {
		t.Errorf("rounds-4 round trip = %+v, %v", res, err)
	}
	if c4 == mustEncode(t, p8, 42) {
		t.Errorf("rounds 4 and 8 produced the same code %q", c4)
	}

	// The keyed variant differs from the frozen-key tier.
	frozen := mustNew(t, ExpandableV1())
	if mustEncode(t, frozen, 42) == mustEncode(t, p8, 42) {
		t.Errorf("frozen and keyed tiers produced the same code")
	}
}

func TestExpandableMixedModeInterop(t *testing.T) {
	// Explicit mode "fixed" behaves identically to an omitted mode.
	explicitProfile := MediumV1()
	explicitProfile.Mode = "fixed"
	explicit := mustNew(t, explicitProfile)
	implicit := mustNew(t, MediumV1())
	for _, id := range []int64{0, 1, 813, 123456789, 481890303} {
		e, eErr := explicit.Encode(big.NewInt(id))
		i, iErr := implicit.Encode(big.NewInt(id))
		if (eErr == nil) != (iErr == nil) || e != i {
			t.Errorf("id %d: explicit %q/%v, implicit %q/%v", id, e, eErr, i, iErr)
		}
		if eErr == nil {
			re, err1 := explicit.Decode(e, nil)
			ri, err2 := implicit.Decode(e, nil)
			if err1 != nil || err2 != nil || re.ID.Cmp(ri.ID) != 0 {
				t.Errorf("decode %q diverged: %+v/%v vs %+v/%v", e, re, err1, ri, err2)
			}
		}
	}

	// A 4-character code presented to a fixed tier fails exactly as
	// before: re-padded per spec 3.4, then INVALID_CHECKSUM.
	fixed := mustNew(t, MediumV1())
	result := fixed.Validate("ABCD", nil)
	if result.Valid || result.Reason != INVALID_CHECKSUM {
		t.Errorf("validate ABCD = %+v, want INVALID_CHECKSUM", result)
	}

	// The decoder must not guess mode from input: an expandable profile
	// rejects a fixed-tier 8-symbol code on the checksum, per spec 19.7.
	expandable := mustNew(t, ExpandableV1())
	fixedCode := mustEncode(t, fixed, 123456789)
	if result := expandable.Validate(fixedCode, nil); result.Valid {
		t.Errorf("expandable accepted fixed-tier code %q", fixedCode)
	}

	// Grouping validation: expandable rejects a configured pattern, fixed
	// still requires the sum.
	if _, err := New(ExpandableV1()); err != nil {
		t.Errorf("expandable tier rejected: %v", err)
	}
	badExpandable := ExpandableV1()
	badExpandable.Grouping = []int{4, 4}
	if _, err := New(badExpandable); err == nil {
		t.Errorf("expandable profile with non-empty grouping accepted")
	} else {
		assertCode(t, err, INVALID_PROFILE)
	}
	badGrouping := MediumV1()
	badGrouping.Grouping = []int{3, 3}
	if _, err := New(badGrouping); err == nil {
		t.Errorf("fixed profile with non-summing grouping accepted")
	} else {
		assertCode(t, err, INVALID_PROFILE)
	}
	badSepMin := MediumV1()
	badSepMin.SeparatorMinLength = 6
	if _, err := New(badSepMin); err == nil {
		t.Errorf("fixed profile with separatorMinLength accepted")
	} else {
		assertCode(t, err, INVALID_PROFILE)
	}
	// minLength must exceed checksumLength.
	if _, err := New(customExpandable(func(p *Profile) { p.MinLength = 1 })); err == nil {
		t.Errorf("minLength <= checksumLength accepted")
	} else {
		assertCode(t, err, INVALID_PROFILE)
	}
}

// TestEncodeHugeIDOutOfRangeFast guards the algorithmic-DoS fix: an
// adversarial id must be rejected before generationForId loops over
// big-integer multiplications with no ceiling.
func TestEncodeHugeIDOutOfRangeFast(t *testing.T) {
	h := mustNew(t, ExpandableV1())
	huge, ok := new(big.Int).SetString("1"+strings.Repeat("0", 100000), 10)
	if !ok {
		t.Fatal("failed to build the huge test id")
	}
	start := time.Now()
	_, err := h.Encode(huge)
	if err == nil {
		t.Fatal("huge id encoded")
	}
	assertCode(t, err, OUT_OF_RANGE)
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Errorf("huge id rejection took %v, want a fast failure", elapsed)
	}
}

// TestMaxCorrectionsBoundary pins the spec-10 budget semantics: nil selects
// the default of 1, an explicit 0 disables candidate generation, and any
// other value is rejected at the boundary.
func TestMaxCorrectionsBoundary(t *testing.T) {
	h := mustNew(t, ExpandableV1())
	// C and G are confusable under the heavy map and both survive in the
	// 27-symbol body alphabet; find a code containing one in the body.
	var code string
	var raw string
	for probe := int64(0); probe < 5000000; probe++ {
		c, ok := encodeOrSkip(t, h, big.NewInt(probe))
		if !ok {
			continue
		}
		r := rawCode(c)
		for pos := 0; pos < len(r)-2; pos++ {
			if r[pos] == 'C' || r[pos] == 'G' {
				code = c
				raw = r
				break
			}
		}
		if code != "" {
			break
		}
	}
	if code == "" {
		t.Skip("no C/G body symbol in range")
	}
	// Create a typo by swapping C<->G at the first occurrence.
	typo := ""
	for pos := 0; pos < len(raw)-2; pos++ {
		if raw[pos] == 'C' {
			typo = raw[:pos] + "G" + raw[pos+1:]
			break
		}
		if raw[pos] == 'G' {
			typo = raw[:pos] + "C" + raw[pos+1:]
			break
		}
	}
	if typo == "" {
		t.Skip("no confusable body symbol in the test code")
	}

	zero, two := 0, 2
	// An explicit 0 disables correction: the typo fails INVALID_CHECKSUM.
	if _, err := h.Decode(typo, &DecodeOptions{
		TryCorrection: true, ConfusionProfile: "heavy", MaxCorrections: &zero,
	}); err == nil {
		t.Errorf("MaxCorrections 0 corrected %q anyway", typo)
	} else {
		assertCode(t, err, INVALID_CHECKSUM)
	}
	// The nil default still corrects.
	if _, err := h.Decode(typo, &DecodeOptions{
		TryCorrection: true, ConfusionProfile: "heavy",
	}); err != nil {
		t.Errorf("nil MaxCorrections failed to correct %q: %v", typo, err)
	}
	// Out-of-spec values are rejected, not clamped.
	if _, err := h.Decode(typo, &DecodeOptions{
		TryCorrection: true, ConfusionProfile: "heavy", MaxCorrections: &two,
	}); err == nil {
		t.Errorf("MaxCorrections 2 accepted")
	} else {
		assertCode(t, err, INVALID_PROFILE)
	}
}
