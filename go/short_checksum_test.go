package baseh

import (
	"errors"
	"math/big"
	"regexp"
	"strings"
	"testing"
)

// firstIssuable finds the first issuable id at or after from.
func firstIssuable(t *testing.T, h *Codec, from *big.Int) *big.Int {
	t.Helper()
	id := new(big.Int).Set(from)
	limit := new(big.Int).Add(from, big.NewInt(10000))
	for id.Cmp(limit) < 0 {
		if _, err := h.Encode(id); err == nil {
			return id
		}
		id.Add(id, big.NewInt(1))
	}
	t.Fatalf("no issuable id from %s", from)
	return nil
}

func expectCode(t *testing.T, err error, code ErrorCode) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected %s, got nil", code)
	}
	var herr *Error
	if !errors.As(err, &herr) || herr.Code != code {
		t.Fatalf("error = %v, want code %s", err, code)
	}
}

func TestShortChecksumFrozenTierShape(t *testing.T) {
	h := mustNew(t, ExpandableV1())
	if h.prep.profile.ChecksumLength != 2 ||
		h.prep.profile.ShortChecksumLength != 1 ||
		h.prep.profile.ShortChecksumUntil != 5 {
		t.Errorf("checksum fields = %d/%d/%d, want 2/1/5",
			h.prep.profile.ChecksumLength, h.prep.profile.ShortChecksumLength, h.prep.profile.ShortChecksumUntil)
	}
	p := mustNew(t, ExpandablePV1(testKey, "test-01", 0))
	if p.prep.profile.ShortChecksumLength != 1 || p.prep.profile.ShortChecksumUntil != 5 {
		t.Errorf("keyed tier short checksum fields = %d/%d, want 1/5",
			p.prep.profile.ShortChecksumLength, p.prep.profile.ShortChecksumUntil)
	}

	// The effective checksum length resolves per generation.
	for _, e := range []struct {
		length int
		want   int
	}{{4, 1}, {5, 1}, {6, 2}, {8, 2}} {
		if got := effectiveChecksumLength(h.prep, e.length); got != e.want {
			t.Errorf("effectiveChecksumLength(%d) = %d, want %d", e.length, got, e.want)
		}
	}

	// Generation capacities follow the effective K (spec 22.3).
	for _, e := range []struct {
		length int
		want   string
	}{{4, "39304"}, {5, "1336336"}, {6, "1336336"}, {7, "45435424"}, {8, "1544804416"}} {
		if got := generationCapacity(h.prep, e.length).String(); got != e.want {
			t.Errorf("generationCapacity(%d) = %s, want %s", e.length, got, e.want)
		}
	}
}

func TestShortChecksumBoundaryRoundTrips(t *testing.T) {
	h := mustNew(t, ExpandableV1())

	// Round trips the first and last issuable id of generations 4-8.
	for l := 4; l <= 8; l++ {
		first := firstIssuable(t, h, generationBase(h.prep, l))
		last := new(big.Int).Sub(generationBase(h.prep, l+1), big.NewInt(1))
		for _, id := range []*big.Int{first, last} {
			code, err := h.Encode(id)
			if err != nil {
				var herr *Error
				if errors.As(err, &herr) && herr.Code == BLOCKED_CODE {
					continue
				}
				t.Fatalf("encode %s: %v", id, err)
			}
			if got := len(rawCode(code)); got != l {
				t.Errorf("id %s encoded at length %d, want %d", id, got, l)
			}
			res, err := h.Decode(code, nil)
			if err != nil {
				t.Fatalf("decode %q: %v", code, err)
			}
			if res.ID.Cmp(id) != 0 || res.CanonicalCode != code {
				t.Errorf("round trip %s -> %q -> %+v", id, code, res)
			}
		}
	}

	// The short/normal boundary: last gen-5 id and first gen-6 id.
	lastShort := new(big.Int).Sub(generationBase(h.prep, 6), big.NewInt(1)) // 1,375,639
	firstNormal := generationBase(h.prep, 6)                                // 1,375,640
	a := rawCode(mustEncodeBig(t, h, lastShort))
	if len(a) != 5 {
		t.Errorf("last short id encoded at length %d, want 5", len(a))
	}
	res, err := h.Decode(a, nil)
	if err != nil || res.ID.Cmp(lastShort) != 0 {
		t.Errorf("decode %q = %+v, %v; want id %s", a, res, err, lastShort)
	}
	b := rawCode(mustEncodeBig(t, h, firstNormal))
	if len(b) != 6 {
		t.Errorf("first normal id encoded at length %d, want 6", len(b))
	}
	res, err = h.Decode(b, nil)
	if err != nil || res.ID.Cmp(firstNormal) != 0 {
		t.Errorf("decode %q = %+v, %v; want id %s", b, res, err, firstNormal)
	}
}

func mustEncodeBig(t *testing.T, h *Codec, id *big.Int) string {
	t.Helper()
	code, err := h.Encode(id)
	if err != nil {
		t.Fatalf("encode %s: %v", id, err)
	}
	return code
}

func TestShortChecksumEffectiveKDecode(t *testing.T) {
	h := mustNew(t, ExpandableV1())

	// A 4-character code validates against exactly 1 checksum symbol,
	// never 2.
	id := firstIssuable(t, h, big.NewInt(0))
	code := rawCode(mustEncodeBig(t, h, id))
	if len(code) != 4 {
		t.Fatalf("id %s encoded at length %d, want 4", id, len(code))
	}
	want, err := calculateChecksum(h.prep, code[:3], 1)
	if err != nil {
		t.Fatalf("calculateChecksum: %v", err)
	}
	if code[3:] != want {
		t.Errorf("checksum = %q, want %q", code[3:], want)
	}
	// Flipping the single checksum symbol fails.
	check := code[3]
	bad := "0"
	if check == '0' {
		bad = "1"
	}
	_, err = h.Decode(code[:3]+bad, nil)
	expectCode(t, err, INVALID_CHECKSUM)
	// Appending a second checksum symbol changes the generation; the split
	// moves and the code fails (spec 19.7), it never validates as gen 4 + 2.
	_, err = h.Decode(code+string(check), nil)
	expectCode(t, err, INVALID_CHECKSUM)

	// Checksum values at short generations use modulus 35, not 1225.
	body := code[:3]
	short, err := calculateChecksum(h.prep, body, 1)
	if err != nil {
		t.Fatalf("calculateChecksum: %v", err)
	}
	full, err := calculateChecksum(h.prep, body, 2)
	if err != nil {
		t.Fatalf("calculateChecksum: %v", err)
	}
	if len(short) != 1 || len(full) != 2 || code[3:] != short {
		t.Errorf("short/full = %q/%q, code checksum %q", short, full, code[3:])
	}
}

func TestShortChecksumInteractions(t *testing.T) {
	h := mustNew(t, ExpandableV1())

	// The separator threshold is still a function of total length
	// (spec 22.4): length 5 renders bare even though its body grew;
	// length 6 splits.
	if strings.Contains(mustEncodeBig(t, h, generationBase(h.prep, 5)), "-") {
		t.Errorf("length-5 code contains a separator")
	}
	gen6 := mustEncodeBig(t, h, firstIssuable(t, h, generationBase(h.prep, 6)))
	if !regexp.MustCompile(`^...-...$`).MatchString(gen6) {
		t.Errorf("length-6 code %q does not match ^...-...$", gen6)
	}

	// The repetition scan covers body plus the short checksum (spec 22.4).
	// Probe with the filter off to find an id whose 4-symbol raw code is a
	// run of 4 (necessarily spanning body and the single checksum symbol),
	// then confirm the frozen tier blocks it.
	probeProfile := ExpandableV1()
	probeProfile.MaxRepetition = 0
	probe := mustNew(t, probeProfile)
	var found *big.Int
	limit := generationBase(h.prep, 5)
	for id := big.NewInt(0); id.Cmp(limit) < 0 && found == nil; id.Add(id, big.NewInt(1)) {
		c, err := probe.Encode(id)
		if err != nil {
			continue
		}
		r := rawCode(c)
		if len(r) == 4 && r[0] == r[1] && r[1] == r[2] && r[2] == r[3] {
			found = new(big.Int).Set(id)
		}
	}
	if found == nil {
		t.Fatalf("expected a gen-4 code with a run of 4")
	}
	_, err := h.Encode(found)
	expectCode(t, err, BLOCKED_CODE)
}

func TestShortChecksumValidation(t *testing.T) {
	base := ExpandableV1()

	// The fields are rejected in fixed mode.
	fixed := MediumV1()
	fixed.ShortChecksumLength = 1
	fixed.ShortChecksumUntil = 5
	if _, err := New(fixed); err == nil {
		t.Errorf("fixed mode with short checksum accepted")
	} else {
		assertCode(t, err, INVALID_PROFILE)
	}
	fixedUntil := MediumV1()
	fixedUntil.ShortChecksumUntil = 5
	if _, err := New(fixedUntil); err == nil {
		t.Errorf("fixed mode with shortChecksumUntil accepted")
	} else {
		assertCode(t, err, INVALID_PROFILE)
	}

	// shortChecksumLength >= checksumLength is rejected.
	for _, k := range []int{2, 3} {
		p := base
		p.ShortChecksumLength = k
		p.ShortChecksumUntil = 5
		if _, err := New(p); err == nil {
			t.Errorf("shortChecksumLength %d accepted", k)
		} else {
			assertCode(t, err, INVALID_PROFILE)
		}
	}

	// shortChecksumUntil below minLength is rejected.
	p := base
	p.ShortChecksumLength = 1
	p.ShortChecksumUntil = 3
	if _, err := New(p); err == nil {
		t.Errorf("shortChecksumUntil 3 accepted")
	} else {
		assertCode(t, err, INVALID_PROFILE)
	}

	// minLength <= shortChecksumLength is rejected.
	p = base
	p.MinLength = 1
	p.ShortChecksumLength = 1
	p.ShortChecksumUntil = 5
	if _, err := New(p); err == nil {
		t.Errorf("minLength 1 with shortChecksumLength 1 accepted")
	} else {
		assertCode(t, err, INVALID_PROFILE)
	}

	// shortChecksumUntil alone is a legal zero-checksum window (amendment).
	p = base
	p.ShortChecksumLength = 0
	p.ShortChecksumUntil = 5
	zero := mustNew(t, p)
	if zero.prep.profile.ShortChecksumLength != 0 {
		t.Errorf("ShortChecksumLength = %d, want 0", zero.prep.profile.ShortChecksumLength)
	}

	// shortChecksumLength without shortChecksumUntil is rejected.
	p = base
	p.ShortChecksumLength = 1
	p.ShortChecksumUntil = 0
	if _, err := New(p); err == nil {
		t.Errorf("shortChecksumLength without shortChecksumUntil accepted")
	} else {
		assertCode(t, err, INVALID_PROFILE)
	}

	// shortChecksumUntil above 8 is rejected; 8 is accepted.
	p = base
	p.ShortChecksumLength = 1
	p.ShortChecksumUntil = 9
	if _, err := New(p); err == nil {
		t.Errorf("shortChecksumUntil 9 accepted")
	} else {
		assertCode(t, err, INVALID_PROFILE)
	}
	p = base
	p.ShortChecksumLength = 1
	p.ShortChecksumUntil = 8
	mustNew(t, p)

	// 0 turns the feature off and keeps the old shape.
	off := mustNew(t, customExpandableShortOff(base))
	if off.prep.profile.ShortChecksumLength != 0 {
		t.Errorf("ShortChecksumLength = %d, want 0", off.prep.profile.ShortChecksumLength)
	}
	if got := generationCapacity(off.prep, 4).String(); got != "1156" {
		t.Errorf("generationCapacity(4) = %s, want 1156", got)
	}
	if got := effectiveChecksumLength(off.prep, 4); got != 2 {
		t.Errorf("effectiveChecksumLength(4) = %d, want 2", got)
	}
	code := mustEncode(t, off, 1155)
	if len(rawCode(code)) != 4 {
		t.Errorf("id 1155 encoded at length %d, want 4", len(rawCode(code)))
	}
	res, err := off.Decode(code, nil)
	if err != nil || res.ID.Int64() != 1155 {
		t.Errorf("round trip %q -> %+v, %v", code, res, err)
	}
}

func customExpandableShortOff(p Profile) Profile {
	p.ShortChecksumLength = 0
	p.ShortChecksumUntil = 0
	return p
}

func TestShortChecksumCustomWindow(t *testing.T) {
	// A custom short-checksum window round trips at every generation.
	p := ExpandableV1()
	p.ProfileID = "short-window-test"
	p.MinLength = 4
	p.ChecksumLength = 2
	p.ShortChecksumLength = 1
	p.ShortChecksumUntil = 6
	p.Permutation = Permutation{Enabled: false}
	p.Profanity = Profanity{Mode: ProfanityNone}
	p.MaxRepetition = 0
	h := mustNew(t, p)

	// Body sizes: 3, 4, 5 through length 6 (K = 1), then L - 2.
	pow := func(n int64) string {
		return new(big.Int).Exp(big.NewInt(34), big.NewInt(n), nil).String()
	}
	for _, e := range []struct {
		length int
		want   string
	}{{4, pow(3)}, {6, pow(5)}, {7, pow(5)}} {
		if got := generationCapacity(h.prep, e.length).String(); got != e.want {
			t.Errorf("generationCapacity(%d) = %s, want %s", e.length, got, e.want)
		}
	}
	if generationCapacity(h.prep, 6).Cmp(generationCapacity(h.prep, 5)) <= 0 {
		t.Errorf("generation 6 capacity not above generation 5")
	}
	for l := 4; l <= 8; l++ {
		id := new(big.Int).Add(generationBase(h.prep, l), big.NewInt(7))
		code := mustEncodeBig(t, h, id)
		if got := len(rawCode(code)); got != l {
			t.Errorf("id %s encoded at length %d, want %d", id, got, l)
		}
		res, err := h.Decode(code, nil)
		if err != nil || res.ID.Cmp(id) != 0 {
			t.Errorf("round trip %s -> %q -> %+v, %v", id, code, res, err)
		}
	}
}

// zeroWindowProfile is the spec-22 amendment shape: a set window with a
// short checksum length of 0 (no checksum symbols inside the window).
func zeroWindowProfile() Profile {
	p := ExpandableV1()
	p.ProfileID = "short-zero-test"
	p.MinLength = 4
	p.ChecksumLength = 2
	p.ShortChecksumLength = 0
	p.ShortChecksumUntil = 5
	p.Permutation = Permutation{Enabled: false}
	p.Profanity = Profanity{Mode: ProfanityNone}
	p.MaxRepetition = 0
	return p
}

func TestShortChecksumZeroWindow(t *testing.T) {
	h := mustNew(t, zeroWindowProfile())

	// Effective K of 0 inside the window, checksumLength above it.
	for _, e := range []struct {
		length int
		want   int
	}{{4, 0}, {5, 0}, {6, 2}} {
		if got := effectiveChecksumLength(h.prep, e.length); got != e.want {
			t.Errorf("effectiveChecksumLength(%d) = %d, want %d", e.length, got, e.want)
		}
	}

	// Window generations are all body: capacity is A^L.
	pow := func(n int64) string {
		return new(big.Int).Exp(big.NewInt(34), big.NewInt(n), nil).String()
	}
	for _, e := range []struct {
		length int
		want   string
	}{{4, pow(4)}, {5, pow(5)}, {6, pow(4)}} {
		if got := generationCapacity(h.prep, e.length).String(); got != e.want {
			t.Errorf("generationCapacity(%d) = %s, want %s", e.length, got, e.want)
		}
	}

	// Round trips generations 4 through 6 with no checksum symbols in the
	// window.
	for l := 4; l <= 6; l++ {
		first := firstIssuable(t, h, generationBase(h.prep, l))
		last := new(big.Int).Sub(generationBase(h.prep, l+1), big.NewInt(1))
		for _, id := range []*big.Int{first, last} {
			code, err := h.Encode(id)
			if err != nil {
				var herr *Error
				if errors.As(err, &herr) && herr.Code == BLOCKED_CODE {
					continue
				}
				t.Fatalf("encode %s: %v", id, err)
			}
			if got := len(rawCode(code)); got != l {
				t.Errorf("id %s encoded at length %d, want %d", id, got, l)
			}
			res, err := h.Decode(code, nil)
			if err != nil || res.ID.Cmp(id) != 0 || res.CanonicalCode != code {
				t.Errorf("round trip %s -> %q -> %+v, %v", id, code, res, err)
			}
		}
	}

	// The checksum of zero symbols is the empty string.
	id := generationBase(h.prep, 4)
	code := rawCode(mustEncodeBig(t, h, id))
	if len(code) != 4 {
		t.Fatalf("id %s encoded at length %d, want 4", id, len(code))
	}
	if got, err := calculateChecksum(h.prep, code, 0); err != nil || got != "" {
		t.Errorf("calculateChecksum(k=0) = %q, %v; want empty", got, err)
	}
}

func TestShortChecksumZeroWindowNoDetection(t *testing.T) {
	h := mustNew(t, zeroWindowProfile())

	// A typo at a zero-checksum generation is NOT detected (documented
	// trade-off): there is no checksum to fail, so the mistyped body
	// silently decodes to a different id.
	id := new(big.Int).Add(generationBase(h.prep, 4), big.NewInt(1))
	code := rawCode(mustEncodeBig(t, h, id))
	last := code[3]
	replacement := byte('1')
	if last == '1' {
		replacement = '2'
	}
	typed := code[:3] + string(replacement)
	res, err := h.Decode(typed, nil)
	if err != nil {
		t.Fatalf("decode %q: %v", typed, err)
	}
	if res.ID.Cmp(id) == 0 {
		t.Errorf("typo %q decoded to the original id %s", typed, id)
	}

	// Correction never engages at zero-checksum generations: the checksum
	// check cannot fail, so a typo decodes as-is with corrected false.
	id5 := new(big.Int).Add(generationBase(h.prep, 5), big.NewInt(3))
	code5 := rawCode(mustEncodeBig(t, h, id5))
	opts := &DecodeOptions{TryCorrection: true, ConfusionProfile: "heavy"}
	res, err = h.Decode(code5, opts)
	if err != nil || res.ID.Cmp(id5) != 0 || res.Corrected {
		t.Errorf("decode %q = %+v, %v; want id %s uncorrected", code5, res, err, id5)
	}
	last = code5[4]
	replacement = '1'
	if last == '1' {
		replacement = '2'
	}
	typed5 := code5[:4] + string(replacement)
	res, err = h.Decode(typed5, opts)
	if err != nil {
		t.Fatalf("decode %q: %v", typed5, err)
	}
	if res.ID.Cmp(id5) == 0 || res.Corrected {
		t.Errorf("typo %q = %+v; want a different id, uncorrected", typed5, res)
	}
}

func TestShortChecksumZeroWindowRepetition(t *testing.T) {
	h := mustNew(t, zeroWindowProfile())

	// The repetition scan covers the whole all-body code (spec 22.4).
	filteredProfile := zeroWindowProfile()
	filteredProfile.MaxRepetition = 4
	filtered := mustNew(t, filteredProfile)
	var found *big.Int
	limit := generationCapacity(h.prep, 4)
	for id := big.NewInt(0); id.Cmp(limit) < 0 && found == nil; id.Add(id, big.NewInt(1)) {
		c, err := h.Encode(id)
		if err != nil {
			continue
		}
		r := rawCode(c)
		if len(r) == 4 && r[0] == r[1] && r[1] == r[2] && r[2] == r[3] {
			found = new(big.Int).Set(id)
		}
	}
	if found == nil {
		t.Fatalf("expected a gen-4 code with a run of 4")
	}
	_, err := filtered.Encode(found)
	expectCode(t, err, BLOCKED_CODE)
}

func TestShortChecksumUntil8Boundary(t *testing.T) {
	p := ExpandableV1()
	p.ProfileID = "short-until-8-test"
	p.MinLength = 4
	p.ChecksumLength = 2
	p.ShortChecksumLength = 1
	p.ShortChecksumUntil = 8
	p.Permutation = Permutation{Enabled: false}
	p.Profanity = Profanity{Mode: ProfanityNone}
	p.MaxRepetition = 0
	h := mustNew(t, p)

	// Generation 8 carries one checksum symbol, generation 9 carries two.
	id8 := new(big.Int).Add(generationBase(h.prep, 8), big.NewInt(5))
	c8 := rawCode(mustEncodeBig(t, h, id8))
	if len(c8) != 8 {
		t.Fatalf("id %s encoded at length %d, want 8", id8, len(c8))
	}
	want8, err := calculateChecksum(h.prep, c8[:7], 1)
	if err != nil || c8[7:] != want8 {
		t.Errorf("gen-8 checksum = %q, want %q (%v)", c8[7:], want8, err)
	}
	res, err := h.Decode(c8, nil)
	if err != nil || res.ID.Cmp(id8) != 0 {
		t.Errorf("round trip %q -> %+v, %v", c8, res, err)
	}

	id9 := new(big.Int).Add(generationBase(h.prep, 9), big.NewInt(5))
	c9 := rawCode(mustEncodeBig(t, h, id9))
	if len(c9) != 9 {
		t.Fatalf("id %s encoded at length %d, want 9", id9, len(c9))
	}
	want9, err := calculateChecksum(h.prep, c9[:7], 2)
	if err != nil || c9[7:] != want9 {
		t.Errorf("gen-9 checksum = %q, want %q (%v)", c9[7:], want9, err)
	}
	res, err = h.Decode(c9, nil)
	if err != nil || res.ID.Cmp(id9) != 0 {
		t.Errorf("round trip %q -> %+v, %v", c9, res, err)
	}
}
