package baseh

// Cross-language round-trip soak suite, per spec/IMPLEMENTATION_SOAK_TESTS.md.
//
// Two run levels share one implementation:
//
//   - CI subset (default): sweep capped at 100,000 ids per profile/variant,
//     10,000 random samples. Runs inside the normal `go test` run.
//   - Full soak (opt-in): sweep to min(1e9, capacity) per profile and
//     1,000,000 random samples. Selected with BASEH_SOAK=1; without it the
//     soak tests skip cleanly.
//
// Bounds and sample counts can be overridden for smoke runs with
// BASEH_SOAK_SWEEP and BASEH_SOAK_RANDOM.

import (
	"encoding/hex"
	"errors"
	"math/big"
	"math/rand"
	"os"
	"strconv"
	"testing"
	"time"
)

// soakTestKey is the fixed 32-byte key for the -p variants (spec section 2).
var soakTestKey, _ = hex.DecodeString("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff")

const (
	soakKeyID       = "soak-test"
	soakSeed        = int64(42)
	soakCISweep     = int64(100_000)
	soakCIRandom    = 10_000
	soakFullRandom  = 1_000_000
	soakRandomLower = int64(1_000_000_000)
	soakRandomSpan  = int64(100_000_000_000) - soakRandomLower
	soakAbsoluteTop = int64(1_000_000_000)
)

type soakTarget struct {
	name  string
	build func() Profile
}

func soakTargets() []soakTarget {
	return []soakTarget{
		{"baseh-minimum-v1", MinimumV1},
		{"baseh-minimum-p-v1", func() Profile { return MinimumPV1(soakTestKey, soakKeyID, 8) }},
		{"baseh-light-v1", LightV1},
		{"baseh-light-p-v1", func() Profile { return LightPV1(soakTestKey, soakKeyID, 8) }},
		{"baseh-medium-v1", MediumV1},
		{"baseh-medium-p-v1", func() Profile { return MediumPV1(soakTestKey, soakKeyID, 8) }},
		{"baseh-heavy-v1", HeavyV1},
		{"baseh-heavy-p-v1", func() Profile { return HeavyPV1(soakTestKey, soakKeyID, 8) }},
		{"baseh-expandable-v1", ExpandableV1},
		{"baseh-expandable-p-v1", func() Profile { return ExpandablePV1(soakTestKey, soakKeyID, 8) }},
	}
}

// permOffTwin copies a profile with the permutation disabled, mirroring the
// twin-profile pattern of the repetition tests. Disabling is profile-wide,
// so it covers every expandable generation.
func permOffTwin(p Profile) Profile {
	twin := p
	twin.Permutation.Enabled = false
	return twin
}

func soakEnvInt(name string, fallback int64) int64 {
	if v, err := strconv.ParseInt(os.Getenv(name), 10, 64); err == nil && v > 0 {
		return v
	}
	return fallback
}

// soakSweepBound returns the soak sweep bound for a codec: min(1e9, capacity)
// for fixed tiers, 1e9 for expandable (which has no fixed capacity).
func soakSweepBound(t *testing.T, h *Codec) int64 {
	t.Helper()
	capacity, err := h.Capacity()
	if err != nil {
		return soakAbsoluteTop
	}
	if !capacity.IsInt64() || capacity.Int64() > soakAbsoluteTop {
		return soakAbsoluteTop
	}
	return capacity.Int64()
}

func isBlocked(err error) bool {
	var e *BasehError
	return errors.As(err, &e) && e.Code == BLOCKED_CODE
}

// runSweep round-trips every id in [0, bound), counting BLOCKED_CODE encode
// failures and failing the test on any other error or mismatch. It reports
// checked/blocked counts, elapsed time and throughput per profile/variant.
func runSweep(t *testing.T, h *Codec, variant string, bound int64) {
	t.Helper()
	start := time.Now()
	var blocked int64
	nextLog := bound / 10
	for i := int64(0); i < bound; i++ {
		id := big.NewInt(i)
		code, err := h.Encode(id)
		if err != nil {
			if isBlocked(err) {
				blocked++
				continue
			}
			t.Errorf("profile=%s variant=%s phase=sweep id=%d stage=encode: %v",
				h.Profile().ProfileID, variant, i, err)
			return
		}
		res, err := h.Decode(code, nil)
		if err != nil {
			t.Errorf("profile=%s variant=%s phase=sweep id=%d code=%q stage=decode: %v",
				h.Profile().ProfileID, variant, i, code, err)
			return
		}
		if res.ID.Cmp(id) != 0 {
			t.Errorf("profile=%s variant=%s phase=sweep id=%d code=%q stage=compare: decoded id=%s",
				h.Profile().ProfileID, variant, i, code, res.ID)
			return
		}
		if bound >= 1_000_000 && i+1 == nextLog {
			elapsed := time.Since(start).Seconds()
			t.Logf("profile=%s variant=%s phase=sweep progress: %d/%d checked, %d blocked, %.0f ids/s",
				h.Profile().ProfileID, variant, i+1, bound, blocked, float64(i+1)/elapsed)
			nextLog += bound / 10
		}
	}
	elapsed := time.Since(start).Seconds()
	t.Logf("profile=%s variant=%s phase=sweep done: %d checked, %d blocked, %.2fs, %.0f ids/s",
		h.Profile().ProfileID, variant, bound, blocked, elapsed, float64(bound)/elapsed)
}

// runRandom round-trips count ids uniform in [1e9, 1e11) with a seeded RNG.
func runRandom(t *testing.T, h *Codec, variant string, count int64) {
	t.Helper()
	t.Logf("profile=%s variant=%s phase=random seed=%d count=%d range=[%d,%d)",
		h.Profile().ProfileID, variant, soakSeed, count, soakRandomLower, soakRandomLower+soakRandomSpan)
	rng := rand.New(rand.NewSource(soakSeed))
	start := time.Now()
	var blocked int64
	for n := int64(0); n < count; n++ {
		i := soakRandomLower + rng.Int63n(soakRandomSpan)
		id := big.NewInt(i)
		code, err := h.Encode(id)
		if err != nil {
			if isBlocked(err) {
				blocked++
				continue
			}
			t.Errorf("profile=%s variant=%s phase=random seed=%d id=%d stage=encode: %v",
				h.Profile().ProfileID, variant, soakSeed, i, err)
			return
		}
		res, err := h.Decode(code, nil)
		if err != nil {
			t.Errorf("profile=%s variant=%s phase=random seed=%d id=%d code=%q stage=decode: %v",
				h.Profile().ProfileID, variant, soakSeed, i, code, err)
			return
		}
		if res.ID.Cmp(id) != 0 {
			t.Errorf("profile=%s variant=%s phase=random seed=%d id=%d code=%q stage=compare: decoded id=%s",
				h.Profile().ProfileID, variant, soakSeed, i, code, res.ID)
			return
		}
	}
	elapsed := time.Since(start).Seconds()
	t.Logf("profile=%s variant=%s phase=random done: %d checked, %d blocked, %.2fs, %.0f ids/s",
		h.Profile().ProfileID, variant, count, blocked, elapsed, float64(count)/elapsed)
}

// runSweepSuite runs the sweep phase for every profile in both variants.
// The cap argument bounds every profile (CI subset); pass 0 for full bounds.
func runSweepSuite(t *testing.T, cap int64) {
	t.Helper()
	for _, target := range soakTargets() {
		for _, variant := range []struct {
			name  string
			build func() Profile
		}{
			{"permutation-on", target.build},
			{"permutation-off", func() Profile { return permOffTwin(target.build()) }},
		} {
			t.Run(target.name+"/"+variant.name, func(t *testing.T) {
				h := mustNew(t, variant.build())
				bound := soakSweepBound(t, h)
				if cap > 0 && bound > cap {
					bound = cap
				}
				runSweep(t, h, variant.name, bound)
			})
		}
	}
}

// runRandomSuite runs the random phase for both expandable profiles in both
// variants (fixed tiers cannot hold ids at this scale).
func runRandomSuite(t *testing.T, count int64) {
	t.Helper()
	for _, target := range soakTargets() {
		p := target.build()
		if p.Mode != "expandable" {
			continue
		}
		for _, variant := range []struct {
			name  string
			build func() Profile
		}{
			{"permutation-on", target.build},
			{"permutation-off", func() Profile { return permOffTwin(target.build()) }},
		} {
			t.Run(target.name+"/"+variant.name, func(t *testing.T) {
				runRandom(t, mustNew(t, variant.build()), variant.name, count)
			})
		}
	}
}

// TestSoakSweepCI is the CI subset of the sweep phase: 100,000 ids per
// profile/variant, part of the default `go test` run.
func TestSoakSweepCI(t *testing.T) {
	runSweepSuite(t, soakEnvInt("BASEH_SOAK_SWEEP", soakCISweep))
}

// TestSoakRandomCI is the CI subset of the random phase: 10,000 samples per
// expandable profile/variant, part of the default `go test` run.
func TestSoakRandomCI(t *testing.T) {
	runRandomSuite(t, soakEnvInt("BASEH_SOAK_RANDOM", soakCIRandom))
}

// TestSoakSweepFull is the full soak sweep: min(1e9, capacity) per
// profile/variant. Opt-in via BASEH_SOAK=1; skips cleanly otherwise.
func TestSoakSweepFull(t *testing.T) {
	if os.Getenv("BASEH_SOAK") != "1" {
		t.Skip("full soak disabled; set BASEH_SOAK=1 to run")
	}
	runSweepSuite(t, soakEnvInt("BASEH_SOAK_SWEEP", 0))
}

// TestSoakRandomFull is the full soak random phase: 1,000,000 samples per
// expandable profile/variant. Opt-in via BASEH_SOAK=1; skips cleanly
// otherwise.
func TestSoakRandomFull(t *testing.T) {
	if os.Getenv("BASEH_SOAK") != "1" {
		t.Skip("full soak disabled; set BASEH_SOAK=1 to run")
	}
	runRandomSuite(t, soakEnvInt("BASEH_SOAK_RANDOM", soakFullRandom))
}
