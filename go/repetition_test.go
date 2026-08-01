package baseh

import (
	"math/big"
	"strings"
	"testing"
)

// repShape returns the repetition-test profile shape: the baseh32 alphabet
// with one checksum symbol and no separator, mirroring the JS reference
// fixture. It is a test-only fixture, not a shipped helper.
func repShape() Profile {
	p := baseh32Shape()
	p.ProfileID = "rep32-test"
	return p
}

func maxRun(raw string) int {
	best, run := 1, 1
	for i := 1; i < len(raw); i++ {
		if raw[i] == raw[i-1] {
			run++
			if run > best {
				best = run
			}
		} else {
			run = 1
		}
	}
	return best
}

// findIDWithRun returns the first id whose raw code (per a filter-free
// twin) has max run exactly n.
func findIDWithRun(t *testing.T, p Profile, n int64) *big.Int {
	t.Helper()
	twinProfile := p
	twinProfile.MaxRepetition = 0
	twinProfile.Profanity = Profanity{Mode: ProfanityNone}
	twin := mustNew(t, twinProfile)
	limit := big.NewInt(5_000_000)
	for id := big.NewInt(0); id.Cmp(limit) < 0; id.Add(id, big.NewInt(1)) {
		code, err := twin.Encode(id)
		if err != nil {
			t.Fatalf("twin Encode(%v): %v", id, err)
		}
		if int64(maxRun(strings.ReplaceAll(code, "-", ""))) == n {
			return new(big.Int).Set(id)
		}
	}
	t.Fatalf("no id with max run %d below %v", n, limit)
	return nil
}

func assertBlocked(t *testing.T, err error) {
	t.Helper()
	assertCode(t, err, BLOCKED_CODE)
}

func TestRepetitionValidation(t *testing.T) {
	for _, bad := range []int{1, 2} {
		p := repShape()
		p.MaxRepetition = bad
		if _, err := New(p); err == nil {
			t.Fatalf("maxRepetition %d: expected error", bad)
		} else {
			assertCode(t, err, INVALID_PROFILE)
		}
	}
	for _, good := range []int{0, 3, 99} {
		p := repShape()
		p.MaxRepetition = good
		mustNew(t, p)
	}
	// The zero value defaults to off.
	mustNew(t, repShape())
}

func TestRepetitionEncode(t *testing.T) {
	p := repShape()
	p.MaxRepetition = 4
	h := mustNew(t, p)

	t.Run("blocks a run of exactly 4", func(t *testing.T) {
		_, err := h.Encode(findIDWithRun(t, p, 4))
		assertBlocked(t, err)
	})

	t.Run("allows a run of exactly 3 (boundary)", func(t *testing.T) {
		id := findIDWithRun(t, p, 3)
		code, err := h.Encode(id)
		if err != nil {
			t.Fatalf("Encode: %v", err)
		}
		result, err := h.Decode(code, nil)
		if err != nil {
			t.Fatalf("Decode: %v", err)
		}
		if result.ID.Cmp(id) != 0 {
			t.Fatalf("id = %v, want %v", result.ID, id)
		}
	})

	t.Run("is off at 0", func(t *testing.T) {
		off := mustNew(t, repShape())
		id := findIDWithRun(t, p, 4)
		code, err := off.Encode(id)
		if err != nil {
			t.Fatalf("Encode: %v", err)
		}
		result, err := off.Decode(code, nil)
		if err != nil {
			t.Fatalf("Decode: %v", err)
		}
		if result.ID.Cmp(id) != 0 {
			t.Fatalf("id = %v, want %v", result.ID, id)
		}
	})

	t.Run("custom maxRepetition 3 blocks triples", func(t *testing.T) {
		three := repShape()
		three.ProfileID = "rep3-32-test"
		three.MaxRepetition = 3
		_, err := mustNew(t, three).Encode(findIDWithRun(t, three, 3))
		assertBlocked(t, err)
	})

	t.Run("separators do not break a run", func(t *testing.T) {
		// Body "AAAA" renders AA-AA-?: no formatted group shows a run of 4,
		// but the raw code is AAAA + checksum, so the filter fires.
		sep := Profile{
			ProfileID:        "rep16-sep-test",
			BodyAlphabet:     "0123456789ABCDEF",
			BodyLength:       4,
			ChecksumAlphabet: "234679ACDEFGHJKMNPQRTUVWXY",
			ChecksumLength:   1,
			CaseSensitive:    false,
			Separator:        "-",
			Grouping:         []int{2, 2, 1},
			Aliases:          map[string]string{},
			Permutation:      Permutation{Enabled: false},
			MaxRepetition:    4,
		}
		// id = 10*16^3 + 10*16^2 + 10*16 + 10 → body AAAA
		id := big.NewInt(10*16*16*16 + 10*16*16 + 10*16 + 10)
		twinProfile := sep
		twinProfile.MaxRepetition = 0
		twinCode, err := mustNew(t, twinProfile).Encode(id)
		if err != nil {
			t.Fatalf("twin Encode: %v", err)
		}
		if !strings.HasPrefix(twinCode, "AA-AA") {
			t.Fatalf("twin code = %q, want AA-AA prefix", twinCode)
		}
		_, err = mustNew(t, sep).Encode(id)
		assertBlocked(t, err)
	})

	t.Run("issuance skips a blocked id by advancing", func(t *testing.T) {
		id := findIDWithRun(t, p, 4)
		one := big.NewInt(1)
		for {
			code, err := h.Encode(id)
			if err == nil {
				result, err := h.Decode(code, nil)
				if err != nil {
					t.Fatalf("Decode: %v", err)
				}
				if result.ID.Cmp(id) != 0 {
					t.Fatalf("id = %v, want %v", result.ID, id)
				}
				return
			}
			assertBlocked(t, err)
			id.Add(id, one)
		}
	})
}

func TestRepetitionDecode(t *testing.T) {
	p := repShape()
	p.MaxRepetition = 4
	h := mustNew(t, p)
	twin := mustNew(t, repShape())

	t.Run("decode reports BLOCKED_CODE for a code that could never be issued", func(t *testing.T) {
		code, err := twin.Encode(findIDWithRun(t, p, 4))
		if err != nil {
			t.Fatalf("twin Encode: %v", err)
		}
		_, err = h.Decode(code, nil)
		assertBlocked(t, err)
	})

	t.Run("correction never corrects into a blocked code", func(t *testing.T) {
		// "00BBBB" is one light-confusion flip (D→B) from the presented body
		// "00DBBB"; the sole checksum-matching candidate carries a run of 4,
		// so decode surfaces BLOCKED_CODE instead of returning it.
		prep, err := prepareProfile(repShape())
		if err != nil {
			t.Fatalf("prepareProfile: %v", err)
		}
		check, err := calculateChecksum(prep, "00BBBB")
		if err != nil {
			t.Fatalf("calculateChecksum: %v", err)
		}
		_, err = h.Decode("00DBBB"+check, &DecodeOptions{
			TryCorrection:    true,
			ConfusionProfile: "light",
			MaxCorrections:   1,
		})
		assertBlocked(t, err)
	})
}

func TestFrozenTiersRepetition(t *testing.T) {
	tiers := []struct {
		name  string
		build func() Profile
	}{
		{"baseh-minimum-v1", MinimumV1},
		{"baseh-light-v1", LightV1},
		{"baseh-medium-v1", MediumV1},
		{"baseh-heavy-v1", HeavyV1},
		{"baseh-minimum-p-v1", func() Profile { return MinimumPV1(testKey, "default", 8) }},
		{"baseh-light-p-v1", func() Profile { return LightPV1(testKey, "default", 8) }},
		{"baseh-medium-p-v1", func() Profile { return MediumPV1(testKey, "default", 8) }},
		{"baseh-heavy-p-v1", func() Profile { return HeavyPV1(testKey, "default", 8) }},
		{"baseh-expandable-v1", ExpandableV1},
		{"baseh-expandable-p-v1", func() Profile { return ExpandablePV1(testKey, "default", 8) }},
	}
	for _, tier := range tiers {
		t.Run(tier.name, func(t *testing.T) {
			p := tier.build()
			if p.MaxRepetition != 4 {
				t.Fatalf("MaxRepetition = %d, want 4", p.MaxRepetition)
			}
			h := mustNew(t, p)
			_, err := h.Encode(findIDWithRun(t, p, 4))
			assertBlocked(t, err)
		})
	}
}
