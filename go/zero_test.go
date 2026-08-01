package baseh

import (
	"errors"
	"math/big"
	"strings"
	"testing"
)

func assertZeroCode(t *testing.T, err error, want ErrorCode) {
	t.Helper()
	var herr *Error
	if !errors.As(err, &herr) {
		t.Fatalf("error type %T, want *Error", err)
	}
	if herr.Code != want {
		t.Fatalf("code = %s, want %s", herr.Code, want)
	}
}

func TestZeroConfigMatchesFrozenMedium(t *testing.T) {
	medium := mustNew(t, MediumV1())

	cases := []int64{0, 123456789, 481890303}
	for _, n := range cases {
		id := big.NewInt(n)
		want, err := medium.Encode(id)
		if err != nil {
			t.Fatalf("Encode(%d): %v", n, err)
		}
		got, err := ToCode(id)
		if err != nil {
			t.Fatalf("ToCode(%d): %v", n, err)
		}
		if got != want {
			t.Fatalf("ToCode(%d) = %q, want %q", n, got, want)
		}
	}

	// Zero-config parity literals from the JS reference suite.
	parity := map[int64]string{
		0:         "UJEA-4MA7",
		123456789: "C8XP-8J49",
		481890303: "H3C9-2PEM",
	}
	for n, want := range parity {
		got, err := ToCode(big.NewInt(n))
		if err != nil {
			t.Fatalf("ToCode(%d): %v", n, err)
		}
		if got != want {
			t.Errorf("ToCode(%d) = %q, want %q", n, got, want)
		}
	}
}

func TestToCodeStringMatchesBigInt(t *testing.T) {
	fromBig, err := ToCode(big.NewInt(123456789))
	if err != nil {
		t.Fatalf("ToCode: %v", err)
	}
	fromStr, err := ToCodeString("123456789")
	if err != nil {
		t.Fatalf("ToCodeString: %v", err)
	}
	if fromBig != fromStr {
		t.Fatalf("ToCode = %q, ToCodeString = %q", fromBig, fromStr)
	}

	for _, bad := range []string{"", "-1", "12x3", " 7", "1_000"} {
		if _, err := ToCodeString(bad); err == nil {
			t.Fatalf("ToCodeString(%q): expected error", bad)
		} else {
			var herr *Error
			if errors.As(err, &herr) {
				t.Fatalf("ToCodeString(%q): error is *Error, want plain caller error", bad)
			}
		}
	}
}

func TestToCodeOutOfRangeAndBlocked(t *testing.T) {
	_, err := ToCode(big.NewInt(481890304))
	assertZeroCode(t, err, OUT_OF_RANGE)

	_, err = ToCodeString("481890304")
	assertZeroCode(t, err, OUT_OF_RANGE)

	// 813 is reserved by the Medium blocklist once the frozen permutation is applied.
	_, err = ToCode(big.NewInt(813))
	assertZeroCode(t, err, BLOCKED_CODE)
}

func TestFromCodeRoundTrip(t *testing.T) {
	code, err := ToCode(big.NewInt(123456789))
	if err != nil {
		t.Fatalf("ToCode: %v", err)
	}
	id, err := FromCode(code)
	if err != nil {
		t.Fatalf("FromCode(%q): %v", code, err)
	}
	if id.Cmp(big.NewInt(123456789)) != 0 {
		t.Fatalf("FromCode(%q) = %v, want 123456789", code, id)
	}
}

func TestFromCodeLowercaseAliasesAndWhitespace(t *testing.T) {
	code, err := ToCode(big.NewInt(123456789))
	if err != nil {
		t.Fatalf("ToCode: %v", err)
	}
	want := big.NewInt(123456789)

	id, err := FromCode(strings.ToLower(code))
	if err != nil || id.Cmp(want) != 0 {
		t.Fatalf("FromCode(lowercase) = %v, %v; want %v", id, err, want)
	}

	messy := "  " + code[:3] + " " + code[3:5] + "\t" + code[5:] + " \n"
	id, err = FromCode(messy)
	if err != nil || id.Cmp(want) != 0 {
		t.Fatalf("FromCode(whitespace) = %v, %v; want %v", id, err, want)
	}

	// Typed aliases decode to canonical values: O reads as 0.
	id, err = FromCode("UORY-PDCA")
	if err != nil || id.Cmp(big.NewInt(1)) != 0 {
		t.Fatalf("FromCode(UORY-PDCA) = %v, %v; want 1", id, err)
	}
}

func TestFromCodeInvalidInput(t *testing.T) {
	_, err := FromCode("00000000")
	assertZeroCode(t, err, INVALID_CHECKSUM)

	_, err = FromCode("!!!!!!!!")
	assertZeroCode(t, err, INVALID_CHARACTER)

	// B is an alias at Medium: it decodes as 8 rather than failing.
	var code8 string
	var id8 *big.Int
	for id := int64(1); id < 100000; id++ {
		c, err := ToCode(big.NewInt(id))
		if err != nil {
			t.Fatalf("ToCode(%d): %v", id, err)
		}
		if strings.Contains(c, "8") {
			code8, id8 = c, big.NewInt(id)
			break
		}
	}
	if code8 == "" {
		t.Fatal("no medium code contains 8 in range")
	}
	id, err := FromCode(strings.Replace(code8, "8", "B", 1))
	if err != nil || id.Cmp(id8) != 0 {
		t.Fatalf("FromCode(typed B) = %v, %v; want %v", id, err, id8)
	}

	_, err = FromCode("")
	assertZeroCode(t, err, INVALID_LENGTH)
}
