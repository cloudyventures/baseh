// Runnable examples for the baseh Go module.
// Run from go/:  go run ./examples
package main

import (
	"errors"
	"fmt"
	"html/template"
	"math/big"
	"strings"

	baseh "github.com/cloudyventures/baseh/go/v2"
)

func describeErr(err error) string {
	var be *baseh.Error
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
	// 1. Expandable mode (recommended default for new users).
	// Expandable mode: shipping in the next release; shown here as the new default.
	// Codes start at 4 characters and grow automatically as ids climb past
	// each length's capacity — no migration, and old short codes keep decoding.
	fmt.Println("== expandable ==")
	exp, err := baseh.New(baseh.ExpandableV1())
	if err != nil {
		panic(err)
	}
	showStr("Encode(123456789)", func() (string, error) {
		// 4 characters at this namespace size; grows as ids climb.
		return exp.Encode(big.NewInt(123456789))
	})
	expCode, err := exp.Encode(big.NewInt(123456789))
	if err != nil {
		panic(err)
	}
	showID("Decode(...) round trip", func() (*big.Int, error) {
		r, e := exp.Decode(expCode, nil)
		if e != nil {
			return nil, e
		}
		return r.ID, nil
	})

	// 2. Zero configuration: the package-level facade behind the shared
	// baseh-expandable-v1 codec.
	fmt.Println("== zero config ==")
	showStr("Encode(123456789)", func() (string, error) {
		return baseh.Encode(big.NewInt(123456789))
	})
	zcCode, err := baseh.Encode(big.NewInt(123456789))
	if err != nil {
		panic(err)
	}
	showID("Decode(...) round trip", func() (*big.Int, error) {
		r, e := baseh.Decode(zcCode, nil)
		if e != nil {
			return nil, e
		}
		return r.ID, nil
	})
	showID(`Decode("c8xp-8j49") (wrong tier)`, func() (*big.Int, error) {
		r, e := baseh.Decode("c8xp-8j49", nil)
		if e != nil {
			return nil, e
		}
		return r.ID, nil
	})
	showID(`Validate("ZZZZZZZZ")`, func() (*big.Int, error) {
		v := baseh.Validate("ZZZZZZZZ", nil)
		if !v.Valid {
			return nil, fmt.Errorf("invalid: %s", v.Reason)
		}
		return nil, nil
	})

	// 3. A fixed-mode frozen preset: load baseh-medium-v1 and use the full codec.
	fmt.Println("== preset (fixed mode) ==")
	medium, err := baseh.New(baseh.MediumV1())
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
	if capacity, err := medium.Capacity(); err == nil {
		fmt.Printf("Capacity -> %s\n", capacity)
	}

	// 4. Correction: a spoken slip recovers the intended record. The frozen
	// tiers alias the spoken pairs outright (a typed T is a P at Medium), so
	// this demo uses a custom profile that keeps B, D, P and T canonical and
	// lets the light confusion map propose the fix.
	fmt.Println("== correction ==")
	spoken := baseh.MinimumV1()
	spoken.ProfileID = "spoken-v1"
	spoken.ChecksumAlphabet = "234679ACEFGHJKMNPQRUVWXY"
	spoken.ChecksumLength = 2
	spoken.Grouping = []int{4, 4}
	calls, err := baseh.New(spoken)
	if err != nil {
		panic(err)
	}
	showStr("Encode(12325)", func() (string, error) {
		return calls.Encode(big.NewInt(12325))
	})
	// The customer reads "LPXM-1LPA" back as "LTXM-1LPA" (T for P). With
	// correction on, the amended code prints its canonical form.
	corrected, err := calls.Decode("LTXM-1LPA", &baseh.DecodeOptions{
		TryCorrection:    true,
		ConfusionProfile: "light",
	})
	if err != nil {
		fmt.Printf("Decode(\"LTXM-1LPA\") -> returns %s\n", describeErr(err))
	} else {
		fmt.Printf("Decode(\"LTXM-1LPA\") -> Identifier: %s, corrected to %s\n",
			corrected.ID, corrected.CanonicalCode)
	}

	// 5. Customized: load the preset, extend the body and re-group.
	// Profiles also carry a Mode field ("fixed" or "expandable"); all frozen
	// tiers shown above are fixed mode. In expandable mode, MinLength (default
	// 4) sets the starting code width and SeparatorMinLength (6 in the
	// baseh-expandable-v1 tier) controls when hyphens and grouping kick in.
	fmt.Println("== customized ==")
	custom := baseh.MediumV1()
	custom.ProfileID = "orders-v1"
	custom.BodyLength = 7
	custom.Grouping = []int{5, 4}
	orders, err := baseh.New(custom)
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
	if capacity, err := orders.Capacity(); err == nil {
		fmt.Printf("Capacity -> %s\n", capacity)
	}

	// 6. A view helper for html/template: one shared codec built at boot,
	// records rendered as codes at the edge via a FuncMap entry. Runs on the
	// stdlib alone; the matching decode-side pattern is in docs/cookbook.md
	// ("Framework view helpers").
	fmt.Println("== view helper (html/template) ==")
	helper, err := baseh.New(baseh.ExpandableV1())
	if err != nil {
		panic(err)
	}
	tmpl, err := template.New("order").Funcs(template.FuncMap{
		"basehCode": func(id int64) string {
			code, err := helper.Encode(big.NewInt(id))
			if err != nil {
				return ""
			}
			return code
		},
	}).Parse("Order #{{ .ID }} is {{ basehCode .ID }}")
	if err != nil {
		panic(err)
	}
	order := struct{ ID int64 }{123456}
	var buf strings.Builder
	if err := tmpl.Execute(&buf, order); err != nil {
		panic(err)
	}
	fmt.Printf("template output -> %s\n", buf.String())
	orderCode, err := helper.Encode(big.NewInt(order.ID))
	if err != nil {
		panic(err)
	}
	showID("Decode(...) round trip", func() (*big.Int, error) {
		r, e := helper.Decode(orderCode, nil)
		if e != nil {
			return nil, e
		}
		return r.ID, nil
	})
	showID(`Decode("ZZZZ-ZZZZ") (bogus code)`, func() (*big.Int, error) {
		r, e := helper.Decode("ZZZZ-ZZZZ", nil)
		if e != nil {
			return nil, e
		}
		return r.ID, nil
	})
}
