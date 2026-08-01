package baseh

import (
	"math/big"
	"sync"
)

// defaultOnce builds the shared zero-config codec on first use. The frozen
// baseh-expandable-v1 profile is statically valid, so New cannot fail here;
// the error is still surfaced rather than panicked away.
var (
	defaultOnce sync.Once
	defaultH    *Codec
	defaultErr  error
)

// Default returns the shared codec bound to the frozen
// baseh-expandable-v1 profile, the recommended starting point for new
// namespaces. It is constructed lazily on the first call and is safe for
// concurrent use.
func Default() (*Codec, error) {
	defaultOnce.Do(func() {
		defaultH, defaultErr = New(ExpandableV1())
	})
	return defaultH, defaultErr
}

// Encode converts id to a reference code using the shared
// baseh-expandable-v1 codec; see Codec.Encode.
func Encode(id *big.Int) (string, error) {
	h, err := Default()
	if err != nil {
		return "", err
	}
	return h.Encode(id)
}

// Decode parses a reference code using the shared baseh-expandable-v1
// codec; see Codec.Decode.
func Decode(input string, opts *DecodeOptions) (*DecodeResult, error) {
	h, err := Default()
	if err != nil {
		return nil, err
	}
	return h.Decode(input, opts)
}

// Validate checks a reference code using the shared baseh-expandable-v1
// codec; see Codec.Validate.
func Validate(input string, opts *DecodeOptions) ValidateResult {
	h, err := Default()
	if err != nil {
		return ValidateResult{Valid: false, Reason: INVALID_PROFILE}
	}
	return h.Validate(input, opts)
}

// Inspect gives live as-you-type feedback using the shared
// baseh-expandable-v1 codec; see Codec.Inspect.
func Inspect(input string) InspectResult {
	h, err := Default()
	if err != nil {
		return InspectResult{State: InspectInvalid, Reason: INVALID_PROFILE}
	}
	return h.Inspect(input)
}
