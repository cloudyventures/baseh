package baseh

import (
	"errors"
	"math/big"
	"testing"
)

func TestFacadeRoundTrip(t *testing.T) {
	ids := []int64{0, 1, 42, 999, 1000000, 481890303, 9223372036854775807}
	for _, n := range ids {
		code, err := Encode(big.NewInt(n))
		if err != nil {
			t.Fatalf("Encode(%d): %v", n, err)
		}
		if code == "" {
			t.Fatalf("Encode(%d) returned an empty string", n)
		}
		result, err := Decode(code, nil)
		if err != nil {
			t.Fatalf("Decode(%q): %v", code, err)
		}
		if result.ID.Cmp(big.NewInt(n)) != 0 {
			t.Fatalf("round trip of %d gave %s", n, result.ID)
		}
		if !Validate(code, nil).Valid {
			t.Fatalf("Validate(%q) reported invalid", code)
		}
	}
}

func TestFacadeMatchesInstanceAPI(t *testing.T) {
	h, err := New(ExpandableV1())
	if err != nil {
		t.Fatalf("New(ExpandableV1()): %v", err)
	}
	for _, n := range []int64{0, 7, 123456789, 9223372036854775807} {
		id := big.NewInt(n)
		facadeCode, err := Encode(id)
		if err != nil {
			t.Fatalf("Encode(%d): %v", n, err)
		}
		instanceCode, err := h.Encode(id)
		if err != nil {
			t.Fatalf("instance Encode(%d): %v", n, err)
		}
		if facadeCode != instanceCode {
			t.Fatalf("facade %q != instance %q for id %d", facadeCode, instanceCode, n)
		}
		facadeResult, err := Decode(facadeCode, nil)
		if err != nil {
			t.Fatalf("Decode(%q): %v", facadeCode, err)
		}
		instanceResult, err := h.Decode(instanceCode, nil)
		if err != nil {
			t.Fatalf("instance Decode(%q): %v", instanceCode, err)
		}
		if facadeResult.ID.Cmp(instanceResult.ID) != 0 ||
			facadeResult.CanonicalCode != instanceResult.CanonicalCode ||
			facadeResult.Corrected != instanceResult.Corrected {
			t.Fatalf("facade and instance decode disagree for %q", facadeCode)
		}
	}
}

func TestFacadeDecodeErrorSurfacesAsError(t *testing.T) {
	_, err := Decode("!!!!", nil)
	var herr *Error
	if !errors.As(err, &herr) {
		t.Fatalf("Decode returned %T, want *Error", err)
	}
	if herr.Code != INVALID_CHARACTER {
		t.Fatalf("Decode error code = %s, want %s", herr.Code, INVALID_CHARACTER)
	}
	if vr := Validate("!!!!", nil); vr.Valid || vr.Reason != INVALID_CHARACTER {
		t.Fatalf("Validate returned %+v, want invalid with %s", vr, INVALID_CHARACTER)
	}
}
