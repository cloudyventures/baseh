package baseh

// Single-substitution checksum sweep, per spec/IMPLEMENTATION_TEST_SUITE.md
// section 6: sampled bodies x every body position x every other canonical
// symbol must never validate for Light, Medium and Heavy.
//
//   - CI subset (default): 500 sampled bodies per tier, part of the normal
//     `go test` run. Override with BASEH_SOAK_CHECKSUM_SWEEP.
//   - Full sweep (opt-in): the spec's 100,000 sampled bodies per tier.
//     Selected with BASEH_SOAK=1, matching soak_test.go; without it the
//     full test skips cleanly.

import (
	"math/big"
	"math/rand"
	"os"
	"testing"
)

func checksumSweepTiers() []struct {
	name  string
	build func() Profile
} {
	return []struct {
		name  string
		build func() Profile
	}{
		{"baseh-light-v1", LightV1},
		{"baseh-medium-v1", MediumV1},
		{"baseh-heavy-v1", HeavyV1},
	}
}

// runChecksumSweep substitutes every other canonical body symbol into every
// body position of count sampled bodies and fails on any substitution whose
// checksum still validates.
func runChecksumSweep(t *testing.T, count int64) {
	t.Helper()
	rng := rand.New(rand.NewSource(soakSeed))
	for _, tier := range checksumSweepTiers() {
		t.Run(tier.name, func(t *testing.T) {
			h := mustNew(t, tier.build())
			capacity, err := h.Capacity()
			if err != nil {
				t.Fatalf("Capacity: %v", err)
			}
			k := h.prep.profile.ChecksumLength
			bodyLen := h.prep.profile.BodyLength
			var bodies, misses int64
			for bodies < count {
				id := new(big.Int).Rand(rng, capacity)
				code, ok := encodeOrSkip(t, h, id)
				if !ok {
					continue
				}
				body := rawCode(code)[:bodyLen]
				supplied := rawCode(code)[bodyLen:]
				for pos := 0; pos < bodyLen; pos++ {
					for i := 0; i < len(h.prep.bodyNorm); i++ {
						repl := h.prep.bodyNorm[i]
						if repl == body[pos] {
							continue
						}
						mutated := body[:pos] + string(repl) + body[pos+1:]
						checksum, err := calculateChecksum(h.prep, mutated, k)
						if err != nil {
							t.Fatalf("calculateChecksum: %v", err)
						}
						if checksum == supplied {
							misses++
							t.Errorf("body=%s pos=%d repl=%c: substituted body %s kept checksum %s",
								body, pos, repl, mutated, supplied)
						}
					}
				}
				bodies++
			}
			t.Logf("profile=%s bodies=%d substitutions-missed=%d", tier.name, bodies, misses)
		})
	}
}

// TestChecksumSweepCI is the CI subset of the single-substitution sweep,
// part of the default `go test` run.
func TestChecksumSweepCI(t *testing.T) {
	runChecksumSweep(t, soakEnvInt("BASEH_SOAK_CHECKSUM_SWEEP", 500))
}

// TestChecksumSweepFull is the spec's 100,000-sampled-body sweep. Opt-in
// via BASEH_SOAK=1; skips cleanly otherwise.
func TestChecksumSweepFull(t *testing.T) {
	if os.Getenv("BASEH_SOAK") != "1" {
		t.Skip("full checksum sweep disabled; set BASEH_SOAK=1 to run")
	}
	runChecksumSweep(t, soakEnvInt("BASEH_SOAK_CHECKSUM_SWEEP", 100_000))
}
