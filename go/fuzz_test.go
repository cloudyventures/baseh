package baseh

import (
	"errors"
	"math/big"
	"testing"
)

// FuzzDecode hammers decode/validate with arbitrary input: no panic is
// allowed, and every failure must surface as *Error (never an internal id
// or a non-baseh error). Run briefly in `go test`; run for real with
// `go test -fuzz=FuzzDecode -fuzztime=...`.
func FuzzDecode(f *testing.F) {
	codecs := map[string]*Codec{
		"minimum":   mustNewF(f, MinimumV1()),
		"light":     mustNewF(f, LightV1()),
		"medium":    mustNewF(f, MediumV1()),
		"heavy":     mustNewF(f, HeavyV1()),
		"expand":    mustNewF(f, ExpandableV1()),
		"expand-p":  mustNewF(f, ExpandablePV1(testKey, "fuzz", 8)),
		"medium-no": mustNewF(f, func() Profile { p := MediumV1(); p.Permutation.Enabled = false; return p }()),
	}
	seeds := []string{
		"000-000", "Q8K2-M4TX", "AAAA-AAAA", "zzzz-zzzz", "1BCD",
		"", "-", "--", " ", "O0IL1l", "AAAA AA",
		"Q8K2M4TXQ8K2M4TXQ8K2M4TXQ8K2M4TX33", "\xff\xfe\x00",
	}
	for _, seed := range seeds {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, input string) {
		opts := &DecodeOptions{AcceptSpaces: true, TryCorrection: true, ConfusionProfile: "medium"}
		for name, h := range codecs {
			if _, err := h.Decode(input, nil); err != nil {
				var herr *Error
				if !errors.As(err, &herr) {
					t.Fatalf("codec=%s input=%q: non-*Error from Decode: %T %v", name, input, err, err)
				}
			}
			if _, err := h.Decode(input, opts); err != nil {
				var herr *Error
				if !errors.As(err, &herr) {
					t.Fatalf("codec=%s input=%q: non-*Error from correcting Decode: %T %v", name, input, err, err)
				}
			}
			// Validate must never panic or expose an internal id; by
			// construction it cannot return one at all.
			h.Validate(input, opts)
		}
	})
}

func mustNewF(f *testing.F, p Profile) *Codec {
	f.Helper()
	h, err := New(p)
	if err != nil {
		f.Fatalf("New: %v", err)
	}
	return h
}

// BenchmarkEncode measures the expandable hot path: permutation, checksum,
// blocklist and repetition scans.
func BenchmarkEncode(b *testing.B) {
	h, err := New(ExpandableV1())
	if err != nil {
		b.Fatalf("New: %v", err)
	}
	id := big.NewInt(123456789)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := h.Encode(id); err != nil {
			b.Fatalf("Encode: %v", err)
		}
	}
}

// BenchmarkDecode measures the decode hot path on a valid code, including
// normalization, checksum verification and the inverse permutation.
func BenchmarkDecode(b *testing.B) {
	h, err := New(ExpandableV1())
	if err != nil {
		b.Fatalf("New: %v", err)
	}
	code, err := h.Encode(big.NewInt(123456789))
	if err != nil {
		b.Fatalf("Encode: %v", err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := h.Decode(code, nil); err != nil {
			b.Fatalf("Decode: %v", err)
		}
	}
}
