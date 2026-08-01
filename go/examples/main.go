// Runnable examples for the baseh Go module.
// Run from go/:  go run ./examples
package main

import (
	"errors"
	"fmt"
	"math/big"

	basehuman "github.com/matellis/baseh/go"
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
	showID(`FromCode("74UYC19")`, func() (*big.Int, error) {
		return basehuman.FromCode("74UYC19")
	})
	showID(`FromCode("74uyc 19")`, func() (*big.Int, error) {
		return basehuman.FromCode("74uyc 19")
	})
	showID(`FromCode("74UYC1X")`, func() (*big.Int, error) {
		return basehuman.FromCode("74UYC1X")
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
	showID(`Decode("74UYC19").ID`, func() (*big.Int, error) {
		r, e := medium.Decode("74UYC19", nil)
		if e != nil {
			return nil, e
		}
		return r.ID, nil
	})
	showID(`Decode("OOOOOOC").ID (typed aliases)`, func() (*big.Int, error) {
		r, e := medium.Decode("OOOOOOC", nil)
		if e != nil {
			return nil, e
		}
		return r.ID, nil
	})
	showStr("Encode(1131) (blocked word)", func() (string, error) {
		return medium.Encode(big.NewInt(1131))
	})
	showID(`Decode("742YC19") (checksum typo)`, func() (*big.Int, error) {
		r, e := medium.Decode("742YC19", nil)
		if e != nil {
			return nil, e
		}
		return r.ID, nil
	})
	fmt.Printf("Capacity -> %s\n", medium.Capacity())

	// 3. Customized: load a preset, extend the body and add a delimiter.
	fmt.Println("== customized ==")
	custom := basehuman.BasehMediumV1()
	custom.ProfileID = "orders-v1"
	custom.BodyLength = 7
	custom.Separator = "-"
	custom.Grouping = []int{4, 4}
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
	showID(`Decode("D4UY-C190") (bad check)`, func() (*big.Int, error) {
		r, e := orders.Decode("D4UY-C190", nil)
		if e != nil {
			return nil, e
		}
		return r.ID, nil
	})
	fmt.Printf("Capacity -> %s\n", orders.Capacity())
}
