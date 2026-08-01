// Runnable examples for the baseh Go module.
// Run from go/:  go run ./examples
package main

import (
	"errors"
	"fmt"
	"math/big"

	basehuman "github.com/cloudyventures/baseh/go/v2"
)

func describeErr(err error) string {
	var be *basehuman.Error
	if errors.As(err, &be) {
		return fmt.Sprintf("baseh error [%s]: %s (SafeForCustomer=%t)", be.Code, be.Message, be.SafeForCustomer)
	}
	return fmt.Sprintf("error: %s", err)
}

func showStr(label string, fn func() (string, error)) {
	out, err := fn()
	if err != nil {
		fmt.Printf("%s -> returns %s\n", label, describeErr(err))
		return
	}
	fmt.Printf("%s -> %s\n", label, out)
}

func showID(label string, fn func() (*big.Int, error)) {
	out, err := fn()
	if err != nil {
		fmt.Printf("%s -> returns %s\n", label, describeErr(err))
		return
	}
	fmt.Printf("%s -> %s\n", label, out)
}

func main() {
	// 1. Zero configuration: the default Medium tier behind two functions.
	fmt.Println("== zero config ==")
	showStr("ToCode(123456789)", func() (string, error) {
		return basehuman.ToCode(big.NewInt(123456789))
	})
	showStr(`ToCodeString("123456789")`, func() (string, error) {
		return basehuman.ToCodeString("123456789")
	})
	showID(`FromCode("C8XP-8J49")`, func() (*big.Int, error) {
		return basehuman.FromCode("C8XP-8J49")
	})
	showID(`FromCode("c8xp 8j49")`, func() (*big.Int, error) {
		return basehuman.FromCode("c8xp 8j49")
	})
	showID(`FromCode("C8XP-8J4X")`, func() (*big.Int, error) {
		return basehuman.FromCode("C8XP-8J4X")
	})
	showStr("ToCode(481890304)", func() (string, error) {
		return basehuman.ToCode(big.NewInt(481890304))
	})

	// 2. A frozen preset: load baseh-medium-v1 and use the full codec.
	fmt.Println("== preset ==")
	medium, err := basehuman.NewBaseh(basehuman.BasehMediumV1())
	if err != nil {
		panic(err)
	}
	showStr("Encode(123456789)", func() (string, error) {
		return medium.Encode(big.NewInt(123456789))
	})
	showID(`Decode("C8XP-8J49").ID`, func() (*big.Int, error) {
		r, e := medium.Decode("C8XP-8J49", nil)
		if e != nil {
			return nil, e
		}
		return r.ID, nil
	})
	showID(`Decode("UORY-PDCA").ID (typed aliases)`, func() (*big.Int, error) {
		r, e := medium.Decode("UORY-PDCA", nil)
		if e != nil {
			return nil, e
		}
		return r.ID, nil
	})
	showStr("Encode(813) (blocked word)", func() (string, error) {
		return medium.Encode(big.NewInt(813))
	})
	showID(`Decode("C9XP-8J49") (checksum typo)`, func() (*big.Int, error) {
		r, e := medium.Decode("C9XP-8J49", nil)
		if e != nil {
			return nil, e
		}
		return r.ID, nil
	})
	fmt.Printf("Capacity -> %s\n", medium.Capacity())

	// 3. Correction: a spoken slip recovers the intended record. The frozen
	// tiers alias the spoken pairs outright (a typed T is a P at Medium), so
	// this demo uses a custom profile that keeps B, D, P and T canonical and
	// lets the light confusion map propose the fix.
	fmt.Println("== correction ==")
	spoken := basehuman.BasehMinimumV1()
	spoken.ProfileID = "spoken-v1"
	spoken.ChecksumAlphabet = "234679ACEFGHJKMNPQRUVWXY"
	spoken.ChecksumLength = 2
	spoken.Grouping = []int{4, 4}
	calls, err := basehuman.NewBaseh(spoken)
	if err != nil {
		panic(err)
	}
	showStr("Encode(12325)", func() (string, error) {
		return calls.Encode(big.NewInt(12325))
	})
	// The customer reads "LPXM-1LPA" back as "LTXM-1LPA" (T for P). With
	// correction on, the amended code prints its canonical form.
	corrected, err := calls.Decode("LTXM-1LPA", &basehuman.DecodeOptions{
		TryCorrection:    true,
		ConfusionProfile: "light",
	})
	if err != nil {
		fmt.Printf("Decode(\"LTXM-1LPA\") -> returns %s\n", describeErr(err))
	} else {
		fmt.Printf("Decode(\"LTXM-1LPA\") -> Identifier: %s, corrected to %s\n",
			corrected.ID, corrected.CanonicalCode)
	}

	// 4. Customized: load the preset, extend the body and re-group.
	fmt.Println("== customized ==")
	custom := basehuman.BasehMediumV1()
	custom.ProfileID = "orders-v1"
	custom.BodyLength = 7
	custom.Grouping = []int{5, 4}
	orders, err := basehuman.NewBaseh(custom)
	if err != nil {
		panic(err)
	}
	showStr("Encode(123456789)", func() (string, error) {
		return orders.Encode(big.NewInt(123456789))
	})
	code, err := orders.Encode(big.NewInt(123456789))
	if err != nil {
		panic(err)
	}
	showID("Decode(...) round trip", func() (*big.Int, error) {
		r, e := orders.Decode(code, nil)
		if e != nil {
			return nil, e
		}
		return r.ID, nil
	})
	showID(`Decode("ZC8VR-EMJX") (bad check)`, func() (*big.Int, error) {
		r, e := orders.Decode("ZC8VR-EMJX", nil)
		if e != nil {
			return nil, e
		}
		return r.ID, nil
	})
	fmt.Printf("Capacity -> %s\n", orders.Capacity())
}
