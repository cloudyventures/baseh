package basehuman

import (
	"encoding/hex"
	"errors"
	"math/big"
	"math/rand"
	"reflect"
	"strings"
	"testing"
)

var testKey, _ = hex.DecodeString("746573742d6f6e6c792d6b65792d6d6174657269616c2d30303031")

// baseh32Shape returns the baseh32-noperm-test shape from the shared
// vectors. It is a test-only fixture, not a shipped helper: the shipped
// profiles are the four frozen tiers in profiles.go.
func baseh32Shape() Profile {
	return Profile{
		ProfileID:        "baseh32-noperm-test",
		BodyAlphabet:     "0123456789ABCDEFGHJKMNPQRSTVWXYZ",
		BodyLength:       6,
		ChecksumAlphabet: "234679ACDEFGHJKMNPQRTUVWXY",
		ChecksumLength:   1,
		CaseSensitive:    false,
		Separator:        "",
		Grouping:         nil,
		Aliases:          map[string]string{"O": "0", "I": "1", "L": "1"},
		Permutation:      Permutation{Enabled: false},
	}
}

func baseProfile() Profile {
	p := baseh32Shape()
	p.ProfileID = "baseh32-perm-test"
	p.Permutation = Permutation{
		Enabled:   true,
		Algorithm: "feistel-v1",
		KeyID:     "test-01",
		KeyBytes:  testKey,
		Rounds:    8,
	}
	return p
}

func mustNew(t *testing.T, p Profile) *Baseh {
	t.Helper()
	h, err := NewBaseh(p)
	if err != nil {
		t.Fatalf("NewBaseh: %v", err)
	}
	return h
}

func assertCode(t *testing.T, err error, want ErrorCode) {
	t.Helper()
	var herr *Error
	if !errors.As(err, &herr) {
		t.Fatalf("error type %T, want *Error", err)
	}
	if herr.Code != want {
		t.Fatalf("code = %s, want %s", herr.Code, want)
	}
}

func TestProfileValidationRejections(t *testing.T) {
	mut := func(f func(*Profile)) Profile {
		p := baseProfile()
		f(&p)
		return p
	}
	cases := map[string]Profile{
		"empty profile id":        mut(func(p *Profile) { p.ProfileID = "" }),
		"body alphabet too small": mut(func(p *Profile) { p.BodyAlphabet = "0" }),
		"duplicate body symbols":  mut(func(p *Profile) { p.BodyAlphabet = "00ABC" }),
		"case collision body":     mut(func(p *Profile) { p.BodyAlphabet = "AaBC" }),
		"non-ascii body symbol":   mut(func(p *Profile) { p.BodyAlphabet = "01\xc3\xa945" }),
		"body length zero":        mut(func(p *Profile) { p.BodyLength = 0 }),
		"body length negative":    mut(func(p *Profile) { p.BodyLength = -2 }),
		"body length above limit": mut(func(p *Profile) { p.BodyLength = 33 }),
		"checksum length negative": mut(func(p *Profile) {
			p.ChecksumLength = -1
		}),
		"checksum length above limit": mut(func(p *Profile) {
			p.ChecksumLength = 9
		}),
		"checksum alphabet too small": mut(func(p *Profile) { p.ChecksumAlphabet = "2" }),
		"duplicate checksum symbols":  mut(func(p *Profile) { p.ChecksumAlphabet = "22AB" }),
		"case collision checksum":     mut(func(p *Profile) { p.ChecksumAlphabet = "AaBC" }),
		"non-ascii checksum symbol":   mut(func(p *Profile) { p.ChecksumAlphabet = "23\xc3\xa99" }),
		"alias source not ascii":      mut(func(p *Profile) { p.Aliases = map[string]string{"OO": "0"} }),
		"alias target not canonical":  mut(func(p *Profile) { p.Aliases = map[string]string{"U": "!"} }),
		"alias source canonical":      mut(func(p *Profile) { p.Aliases = map[string]string{"0": "1"} }),
		// Real chain: target A is canonical but is also an alias source.
		"alias chain": mut(func(p *Profile) {
			p.Aliases = map[string]string{"O": "A", "A": "0"}
		}),
		// Real cycle: neither target is canonical, rejected at the target
		// check. A cycle cannot exist without a non-canonical target.
		"alias cycle": mut(func(p *Profile) {
			p.Aliases = map[string]string{"O": "I", "I": "O"}
		}),
		"grouping with empty separator": mut(func(p *Profile) { p.Grouping = []int{3, 3, 1} }),
		"separator in body":             mut(func(p *Profile) { p.Separator = "0"; p.Grouping = []int{7} }),
		"separator in checksum":         mut(func(p *Profile) { p.Separator = "2"; p.Grouping = []int{7} }),
		"group total mismatch":          mut(func(p *Profile) { p.Separator = "-"; p.Grouping = []int{3, 3} }),
		"empty grouping with separator": mut(func(p *Profile) { p.Separator = "-"; p.Grouping = nil }),
		"missing permutation key":       mut(func(p *Profile) { p.Permutation.KeyBytes = nil }),
		"missing key id":                mut(func(p *Profile) { p.Permutation.KeyID = "" }),
		"unknown algorithm":             mut(func(p *Profile) { p.Permutation.Algorithm = "xor-v9" }),
		"odd rounds":                    mut(func(p *Profile) { p.Permutation.Rounds = 5 }),
		"too few rounds":                mut(func(p *Profile) { p.Permutation.Rounds = 2 }),
		"too many rounds":               mut(func(p *Profile) { p.Permutation.Rounds = 18 }),
		"bad key hex": mut(func(p *Profile) {
			p.Permutation.KeyBytes = nil
			p.Permutation.KeyBytesHex = "zz"
		}),
		"unknown profanity mode": mut(func(p *Profile) {
			p.Profanity = Profanity{Mode: "silent-edit"}
		}),
		"blocklist word too short": mut(func(p *Profile) {
			p.Profanity = Profanity{Mode: ProfanityBlocklist, Words: []string{"X"}}
		}),
		"blocklist word not letters": mut(func(p *Profile) {
			p.Profanity = Profanity{Mode: ProfanityBlocklist, Words: []string{"W0RD"}}
		}),
		"blocklist word too long": mut(func(p *Profile) {
			p.Profanity = Profanity{Mode: ProfanityBlocklist, ExtraWords: []string{strings.Repeat("A", 33)}}
		}),
		"no-vowels empties checksum alphabet": mut(func(p *Profile) {
			p.ChecksumAlphabet = "AEIO"
			p.Profanity = Profanity{Mode: ProfanityNoVowels}
		}),
	}
	for name, p := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := NewBaseh(p)
			if err == nil {
				t.Fatalf("NewBaseh accepted invalid profile")
			}
			assertCode(t, err, INVALID_PROFILE)
		})
	}
}

func keyedTiers() map[string]Profile {
	return map[string]Profile{
		"baseh-minimum-p-v1": BasehMinimumPV1(testKey, "test-01", 8),
		"baseh-light-p-v1":   BasehLightPV1(testKey, "test-01", 8),
		"baseh-medium-p-v1":  BasehMediumPV1(testKey, "test-01", 8),
		"baseh-heavy-p-v1":   BasehHeavyPV1(testKey, "test-01", 8),
	}
}

func plainTiers() map[string]Profile {
	return map[string]Profile{
		"baseh-minimum-v1": BasehMinimumV1(),
		"baseh-light-v1":   BasehLightV1(),
		"baseh-medium-v1":  BasehMediumV1(),
		"baseh-heavy-v1":   BasehHeavyV1(),
	}
}

func TestShippedProfilesAccepted(t *testing.T) {
	for id, p := range plainTiers() {
		if p.Permutation.Enabled {
			t.Errorf("%s: plain tier has permutation enabled", id)
		}
		if _, err := NewBaseh(p); err != nil {
			t.Errorf("%s: %v", id, err)
		}
	}
	for id, p := range keyedTiers() {
		if _, err := NewBaseh(p); err != nil {
			t.Errorf("%s: %v", id, err)
		}
	}
	// The keyed variants require key material: empty key bytes must fail
	// validation at NewBaseh.
	for _, p := range []Profile{
		BasehMinimumPV1(nil, "", 0),
		BasehLightPV1(nil, "", 0),
		BasehMediumPV1(nil, "", 0),
		BasehHeavyPV1(nil, "", 0),
	} {
		if _, err := NewBaseh(p); err == nil {
			t.Errorf("%s accepted without key material", p.ProfileID)
		} else {
			assertCode(t, err, INVALID_PROFILE)
		}
	}
}

func TestHelpersReturnFreshProfiles(t *testing.T) {
	p := BasehMediumV1()
	delete(p.Aliases, "T")
	if _, ok := BasehMediumV1().Aliases["T"]; !ok {
		t.Errorf("alias mutation leaked into a fresh profile")
	}
	g := BasehMinimumV1()
	g.Grouping[0] = 1
	if got := BasehMinimumV1().Grouping[0]; got != 3 {
		t.Errorf("grouping mutation leaked into a fresh profile: %d", got)
	}
	k := BasehMediumPV1(testKey, "test-01", 8)
	k.Permutation.KeyBytes = nil
	if got := BasehMediumPV1(testKey, "test-01", 8); len(got.Permutation.KeyBytes) == 0 {
		t.Errorf("keyed tier returned a shared key slice")
	}
}

func TestTierCapacities(t *testing.T) {
	want := map[string]string{
		"baseh-minimum-v1": "2176782336",
		"baseh-light-v1":   "887503681",
		"baseh-medium-v1":  "481890304",
		"baseh-heavy-v1":   "308915776",
	}
	tiers := plainTiers()
	for id, p := range keyedTiers() {
		tiers[id] = p
	}
	for id, p := range tiers {
		h := mustNew(t, p)
		plain := id
		if strings.HasSuffix(id, "-p-v1") {
			plain = strings.TrimSuffix(id, "-p-v1") + "-v1"
		}
		if got := h.Capacity().String(); got != want[plain] {
			t.Errorf("%s capacity = %s, want %s", id, got, want[plain])
		}
	}
}

func TestKeyedPermutationDefaults(t *testing.T) {
	// Explicit key id and rounds pass through.
	keyed := BasehMediumPV1(testKey, "test-01", 8)
	perm := keyed.Permutation
	if !perm.Enabled || perm.Algorithm != "feistel-v1" || perm.KeyID != "test-01" || perm.Rounds != 8 {
		t.Errorf("keyed permutation = %+v", perm)
	}
	if keyed.ProfileID != "baseh-medium-p-v1" {
		t.Errorf("keyed profile id = %q", keyed.ProfileID)
	}
	// Empty key id defaults to "default" and zero rounds to 8.
	def := BasehMediumPV1(testKey, "", 0)
	if def.Permutation.KeyID != "default" || def.Permutation.Rounds != 8 {
		t.Errorf("defaults = %+v", def.Permutation)
	}
	// The keyed variant matches its plain tier on every shared field.
	plain := BasehMediumV1()
	if def.BodyAlphabet != plain.BodyAlphabet ||
		def.BodyLength != plain.BodyLength ||
		def.ChecksumAlphabet != plain.ChecksumAlphabet ||
		def.ChecksumLength != plain.ChecksumLength ||
		def.CaseSensitive != plain.CaseSensitive ||
		def.Separator != plain.Separator ||
		!reflect.DeepEqual(def.Aliases, plain.Aliases) ||
		!reflect.DeepEqual(def.Profanity, plain.Profanity) {
		t.Errorf("keyed tier diverges from plain tier")
	}
	// Boundary round trips hold with and without permutation.
	for name, p := range map[string]Profile{"plain": plain, "keyed": def} {
		h := mustNew(t, p)
		for _, id := range []*big.Int{big.NewInt(0), big.NewInt(1), big.NewInt(123456789), new(big.Int).Sub(h.Capacity(), big.NewInt(1))} {
			code, err := h.Encode(id)
			if err != nil {
				t.Fatalf("%s encode %s: %v", name, id, err)
			}
			res, err := h.Decode(code, nil)
			if err != nil || res.ID.Cmp(id) != 0 {
				t.Errorf("%s round trip %s -> %q -> %+v, %v", name, id, code, res, err)
			}
		}
	}
}

func TestBoundaryRoundTrips(t *testing.T) {
	h := mustNew(t, baseProfile())
	capacity := h.Capacity()
	ids := []*big.Int{
		big.NewInt(0),
		big.NewInt(1),
		big.NewInt(31),
		big.NewInt(32),
		big.NewInt(33),
		new(big.Int).Sub(capacity, big.NewInt(2)),
		new(big.Int).Sub(capacity, big.NewInt(1)),
	}
	for _, id := range ids {
		code, err := h.Encode(id)
		if err != nil {
			t.Fatalf("encode %s: %v", id, err)
		}
		res, err := h.Decode(code, nil)
		if err != nil {
			t.Fatalf("decode %q: %v", code, err)
		}
		if res.ID.Cmp(id) != 0 {
			t.Errorf("round trip %s -> %q -> %s", id, code, res.ID)
		}
		if res.Corrected {
			t.Errorf("canonical decode of %q marked corrected", code)
		}
	}
}

func TestOutOfRange(t *testing.T) {
	h := mustNew(t, baseProfile())
	if _, err := h.Encode(h.Capacity()); err == nil {
		t.Errorf("encode(capacity) accepted")
	} else {
		assertCode(t, err, OUT_OF_RANGE)
	}
	if _, err := h.Encode(big.NewInt(-1)); err == nil {
		t.Errorf("encode(-1) accepted")
	} else {
		assertCode(t, err, OUT_OF_RANGE)
	}
	if _, err := h.Encode(nil); err == nil {
		t.Errorf("encode(nil) accepted")
	} else {
		assertCode(t, err, OUT_OF_RANGE)
	}
}

func TestCapacity(t *testing.T) {
	h := mustNew(t, baseProfile())
	if h.Capacity().String() != "1073741824" {
		t.Errorf("capacity = %s", h.Capacity())
	}
	// Returned value is a copy; mutating it must not corrupt the codec.
	c := h.Capacity()
	c.SetInt64(5)
	if h.Capacity().String() != "1073741824" {
		t.Errorf("capacity mutated through returned copy")
	}
}

func TestAliasesAndNormalization(t *testing.T) {
	h := mustNew(t, baseProfile())
	code, err := h.Encode(big.NewInt(123456789))
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if code != "R0XMCMT" {
		t.Fatalf("canonical = %q", code)
	}
	inputs := []string{"r0xmcmt", "  R0XMCMT ", "R0XMCMT"}
	for _, in := range inputs {
		res, err := h.Decode(in, nil)
		if err != nil {
			t.Errorf("decode %q: %v", in, err)
			continue
		}
		if res.ID.Int64() != 123456789 || res.CanonicalCode != code {
			t.Errorf("decode %q -> %s, %q", in, res.ID, res.CanonicalCode)
		}
	}
	// Internal space only with acceptSpaces.
	spaced := "R0X MCMT"
	if _, err := h.Decode(spaced, nil); err == nil {
		t.Errorf("internal space accepted without acceptSpaces")
	}
	if _, err := h.Decode(spaced, &DecodeOptions{AcceptSpaces: true}); err != nil {
		t.Errorf("internal space rejected with acceptSpaces: %v", err)
	}

	// Aliases decode to the canonical id on a no-permutation profile.
	p := baseh32Shape()
	np := mustNew(t, p)
	c, err := np.Encode(big.NewInt(1))
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if c[:6] != "000001" {
		t.Fatalf("noperm body = %q", c[:6])
	}
	aliased := "00000I" + c[6:]
	res, err := np.Decode(aliased, nil)
	if err != nil || res.ID.Int64() != 1 || res.Corrected {
		t.Errorf("alias decode -> %+v, %v", res, err)
	}
}

func TestCorrectionModes(t *testing.T) {
	p := baseh32Shape()
	h := mustNew(t, p)

	// Without tryCorrection a substituted symbol stays a checksum error.
	if _, err := h.Decode("0000TBC", nil); err == nil {
		t.Fatalf("uncorrected input accepted")
	} else {
		assertCode(t, err, INVALID_CHECKSUM)
	}
	// Default confusion profile is "none", so correction without an
	// explicit map cannot help.
	if _, err := h.Decode("0000TBC", &DecodeOptions{TryCorrection: true}); err == nil {
		t.Fatalf("correction with default none map succeeded")
	} else {
		assertCode(t, err, INVALID_CHECKSUM)
	}
	// The light map finds the unique fix.
	res, err := h.Decode("0000TBC", &DecodeOptions{TryCorrection: true, ConfusionProfile: "light"})
	if err != nil || !res.Corrected {
		t.Fatalf("light correction -> %+v, %v", res, err)
	}
	// Unknown confusion profile is a caller error, not customer input.
	if _, err := h.Decode("0000TBC", &DecodeOptions{TryCorrection: true, ConfusionProfile: "loud"}); err == nil {
		t.Fatalf("unknown confusion profile accepted")
	} else {
		assertCode(t, err, INVALID_PROFILE)
	}
}

func TestProfanityBlocklist(t *testing.T) {
	base := func() Profile {
		p := baseh32Shape()
		p.ProfileID = "block32-test"
		p.Profanity = Profanity{Mode: ProfanityBlocklist}
		return p
	}
	h := mustNew(t, base())

	// Vector-driven: id 13066 encodes to raw "000CRA" + one checksum char
	// containing CRAP under this checksum domain, so it is blocked.
	if _, err := h.Encode(big.NewInt(13066)); err == nil {
		t.Fatalf("blocked id encoded")
	} else {
		assertCode(t, err, BLOCKED_CODE)
		var herr *Error
		errors.As(err, &herr)
		if herr.SafeForCustomer {
			t.Errorf("BLOCKED_CODE must not be safe for customer")
		}
	}

	// decode of the blocked raw string also surfaces BLOCKED_CODE, since
	// the canonical form could never have been issued.
	open := base()
	open.Profanity = Profanity{Mode: ProfanityNone}
	openProfile := mustNew(t, open)
	raw, err := openProfile.Encode(big.NewInt(13066))
	if err != nil {
		t.Fatalf("open encode: %v", err)
	}
	if _, err := h.Decode(raw, nil); err == nil {
		t.Fatalf("decode of blocked code succeeded")
	} else {
		assertCode(t, err, BLOCKED_CODE)
	}

	// Words replaces the default list entirely.
	repl := base()
	repl.ProfileID = "block32-replace-test"
	repl.Profanity = Profanity{Mode: ProfanityBlocklist, Words: []string{"ZZZZ"}}
	hr := mustNew(t, repl)
	code, err := hr.Encode(big.NewInt(13066))
	if err != nil || code != "000CRA7" {
		t.Errorf("replacement list should allow CRAP-bearing code, got %q, %v", code, err)
	}

	// ExtraWords appends to the default list. Use bodies that contain the
	// word outright so the case is independent of the checksum domain.
	extra := base()
	extra.ProfileID = "my-extra-test"
	extra.Profanity = Profanity{Mode: ProfanityBlocklist, ExtraWords: []string{"QQQQ"}}
	he := mustNew(t, extra)
	// body 00DAMN: a default-list word.
	if _, err := he.Encode(big.NewInt(436885)); err == nil {
		t.Errorf("default list not applied with extraWords")
	} else {
		assertCode(t, err, BLOCKED_CODE)
	}
	// body 00QQQQ: an extraWords entry.
	if _, err := he.Encode(big.NewInt(777975)); err == nil {
		t.Errorf("extraWords entry not applied")
	} else {
		assertCode(t, err, BLOCKED_CODE)
	}
	// body 000000 plus checksum char: no blocked substring.
	if _, err := he.Encode(big.NewInt(0)); err != nil {
		t.Errorf("innocent id blocked: %v", err)
	}
}

func TestProfanityNoVowels(t *testing.T) {
	p := baseh32Shape()
	p.ProfileID = "novowel32-test"
	p.Profanity = Profanity{Mode: ProfanityNoVowels}
	h, err := NewBaseh(p)
	if err != nil {
		t.Fatalf("novowel profile rejected: %v", err)
	}
	// Stripped body alphabet has 30 symbols: 30^6.
	if h.Capacity().String() != "729000000" {
		t.Errorf("capacity = %s", h.Capacity())
	}
	for _, id := range []int64{0, 1, 2, 728999999} {
		code, err := h.Encode(big.NewInt(id))
		if err != nil {
			t.Fatalf("encode %d: %v", id, err)
		}
		if strings.ContainsAny(code, "AEIOU") {
			t.Errorf("novowel code %q contains a vowel", code)
		}
		res, err := h.Decode(code, nil)
		if err != nil || res.ID.Int64() != id {
			t.Errorf("round trip %d -> %q -> %+v, %v", id, code, res, err)
		}
	}
	// A vowel in typed input is INVALID_CHARACTER.
	if _, err := h.Decode("0000A02", nil); err == nil {
		t.Errorf("vowel input accepted")
	} else {
		assertCode(t, err, INVALID_CHARACTER)
	}
}

func TestValidate(t *testing.T) {
	h := mustNew(t, baseProfile())
	code, err := h.Encode(big.NewInt(42))
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	ok := h.Validate(code, nil)
	if !ok.Valid || ok.CanonicalCode != code || ok.Reason != "" {
		t.Errorf("valid code: %+v", ok)
	}
	bad := h.Validate("0000000", nil)
	if bad.Valid || bad.CanonicalCode != "" || bad.Reason != INVALID_CHECKSUM {
		t.Errorf("invalid code: %+v", bad)
	}
	// Spec 3.4: short input is re-padded, then fails the checksum.
	short := h.Validate("00000", nil)
	if short.Valid || short.Reason != INVALID_CHECKSUM {
		t.Errorf("short code: %+v", short)
	}
}

func TestConfusionMapsExact(t *testing.T) {
	wantLight := map[string][]string{"B": {"D"}, "D": {"B"}, "P": {"T"}, "T": {"P"}}
	wantMedium := map[string][]string{
		"B": {"D"}, "D": {"B"}, "P": {"T"}, "T": {"P"},
		"M": {"N"}, "N": {"M"}, "V": {"W"}, "W": {"V"},
	}
	wantHeavy := map[string][]string{
		"B": {"D"}, "D": {"B"}, "P": {"T"}, "T": {"P"},
		"M": {"N"}, "N": {"M"}, "V": {"W"}, "W": {"V"},
		"F": {"S"}, "S": {"F"}, "C": {"G"}, "G": {"C"},
	}
	for name, want := range map[string]map[string][]string{
		"light": wantLight, "medium": wantMedium, "heavy": wantHeavy,
	} {
		if !reflect.DeepEqual(ConfusionMaps[name], want) {
			t.Errorf("%s map = %v, want %v", name, ConfusionMaps[name], want)
		}
	}
}

func TestDefaultBlocklistExact(t *testing.T) {
	want := []string{
		"CRAP", "TWAT", "SHAG", "DAMN", "FCK", "FUC",
		"SHT", "CNT", "TWT", "DCK", "AZZ", "BCH",
	}
	if !reflect.DeepEqual(DefaultBlocklist, want) {
		t.Errorf("DefaultBlocklist = %v", DefaultBlocklist)
	}
}

func TestSequentialRoundTripSmoke(t *testing.T) {
	h := mustNew(t, baseProfile())
	if testing.Short() {
		t.Skip("skipping 10k smoke in short mode")
	}
	for i := int64(0); i < 10000; i++ {
		id := big.NewInt(i)
		code, err := h.Encode(id)
		if err != nil {
			t.Fatalf("encode %d: %v", i, err)
		}
		res, err := h.Decode(code, nil)
		if err != nil {
			t.Fatalf("decode %q (id %d): %v", code, i, err)
		}
		if res.ID.Cmp(id) != 0 {
			t.Fatalf("round trip %d -> %q -> %s", i, code, res.ID)
		}
	}
}

func TestFuzzSmoke(t *testing.T) {
	h := mustNew(t, baseProfile())
	rng := rand.New(rand.NewSource(1))
	for i := 0; i < 3000; i++ {
		n := rng.Intn(24)
		buf := make([]byte, n)
		for j := range buf {
			// Full byte range: random ASCII, whitespace, separators, null
			// bytes and non-UTF-8 fragments.
			buf[j] = byte(rng.Intn(256))
		}
		input := string(buf)
		_, err := h.Decode(input, &DecodeOptions{
			AcceptSpaces:  rng.Intn(2) == 0,
			TryCorrection: rng.Intn(2) == 0,
		})
		if err != nil {
			var herr *Error
			if !errors.As(err, &herr) {
				t.Fatalf("non-*Error error %T for %q: %v", err, input, err)
			}
			continue
		}
	}
	// Validate must never panic and must expose only an ErrorCode.
	for i := 0; i < 1000; i++ {
		n := rng.Intn(16)
		buf := make([]byte, n)
		for j := range buf {
			buf[j] = byte(rng.Intn(256))
		}
		_ = h.Validate(string(buf), &DecodeOptions{TryCorrection: true, ConfusionProfile: "light"})
	}
}
