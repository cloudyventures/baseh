package basehuman

import (
	"encoding/hex"
	"errors"
	"math/big"
	"math/rand"
	"reflect"
	"testing"
)

var testKey, _ = hex.DecodeString("746573742d6f6e6c792d6b65792d6d6174657269616c2d30303031")

func baseProfile() Profile {
	return HRC32V1Profile(testKey, "test-01")
}

func mustNew(t *testing.T, p Profile) *Hrc {
	t.Helper()
	h, err := NewHrc(p)
	if err != nil {
		t.Fatalf("NewHrc: %v", err)
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
			p.Grouping = []int{6}
		}),
		"checksum length above limit": mut(func(p *Profile) {
			p.ChecksumLength = 9
			p.Grouping = []int{3, 3, 9}
		}),
		"checksum alphabet too small": mut(func(p *Profile) { p.ChecksumAlphabet = "2" }),
		"duplicate checksum symbols":  mut(func(p *Profile) { p.ChecksumAlphabet = "22AB" }),
		"case collision checksum":     mut(func(p *Profile) { p.ChecksumAlphabet = "AaBC" }),
		"non-ascii checksum symbol":   mut(func(p *Profile) { p.ChecksumAlphabet = "23\xc3\xa99" }),
		"separator in body":           mut(func(p *Profile) { p.Separator = "0" }),
		"separator in checksum":       mut(func(p *Profile) { p.Separator = "2" }),
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
		"group total mismatch":    mut(func(p *Profile) { p.Grouping = []int{3, 3} }),
		"empty grouping":          mut(func(p *Profile) { p.Grouping = nil }),
		"missing permutation key": mut(func(p *Profile) { p.Permutation.KeyBytes = nil }),
		"missing key id":          mut(func(p *Profile) { p.Permutation.KeyID = "" }),
		"unknown algorithm":       mut(func(p *Profile) { p.Permutation.Algorithm = "xor-v9" }),
		"odd rounds":              mut(func(p *Profile) { p.Permutation.Rounds = 5 }),
		"too few rounds":          mut(func(p *Profile) { p.Permutation.Rounds = 2 }),
		"too many rounds":         mut(func(p *Profile) { p.Permutation.Rounds = 18 }),
		"bad key hex": mut(func(p *Profile) {
			p.Permutation.KeyBytes = nil
			p.Permutation.KeyBytesHex = "zz"
		}),
	}
	for name, p := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := NewHrc(p)
			if err == nil {
				t.Fatalf("NewHrc accepted invalid profile")
			}
			assertCode(t, err, INVALID_PROFILE)
		})
	}
}

func TestShippedProfilesAccepted(t *testing.T) {
	if _, err := NewHrc(HRC32V1Profile(testKey, "test-01")); err != nil {
		t.Errorf("hrc32-v1: %v", err)
	}
	if _, err := NewHrc(HRC32SV1Profile(testKey, "test-01")); err != nil {
		t.Errorf("hrc32s-v1: %v", err)
	}
	p := HRC32V1Profile(testKey, "test-01")
	p.Permutation = Permutation{Enabled: false}
	if _, err := NewHrc(p); err != nil {
		t.Errorf("no-permutation variant: %v", err)
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
	if code != "VCS-PQ2-G" {
		t.Fatalf("canonical = %q", code)
	}
	inputs := []string{"vcs-pq2-g", "VCSPQ2G", "  VCS-PQ2-G ", "VCS-PQ2-G"}
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
	spaced := "VCS PQ2 G"
	if _, err := h.Decode(spaced, nil); err == nil {
		t.Errorf("internal space accepted without acceptSpaces")
	}
	if _, err := h.Decode(spaced, &DecodeOptions{AcceptSpaces: true}); err != nil {
		t.Errorf("internal space rejected with acceptSpaces: %v", err)
	}
}

func TestCorrectionModes(t *testing.T) {
	p := HRC32V1Profile(testKey, "test-01")
	p.Permutation = Permutation{Enabled: false}
	p.ProfileID = "hrc32-noperm-test"
	h := mustNew(t, p)

	// Without tryCorrection a substituted symbol stays a checksum error.
	if _, err := h.Decode("0000TBJ", nil); err == nil {
		t.Fatalf("uncorrected input accepted")
	} else {
		assertCode(t, err, INVALID_CHECKSUM)
	}
	// Unknown confusion profile is a caller error, not customer input.
	if _, err := h.Decode("0000TBJ", &DecodeOptions{TryCorrection: true, ConfusionProfile: "loud"}); err == nil {
		t.Fatalf("unknown confusion profile accepted")
	} else {
		assertCode(t, err, INVALID_PROFILE)
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
	bad := h.Validate("000-000-0", nil)
	if bad.Valid || bad.CanonicalCode != "" || bad.Reason != INVALID_CHECKSUM {
		t.Errorf("invalid code: %+v", bad)
	}
	short := h.Validate("000-00", nil)
	if short.Valid || short.Reason != INVALID_LENGTH {
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
		_ = h.Validate(string(buf), &DecodeOptions{TryCorrection: true})
	}
}
