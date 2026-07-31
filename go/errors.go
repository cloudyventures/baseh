package basehuman

import "fmt"

// ErrorCode is a stable machine-readable HRC error category. Values match
// the cross-language specification exactly.
type ErrorCode string

// Error codes defined by the HRC codec specification.
const (
	INVALID_PROFILE      ErrorCode = "INVALID_PROFILE"
	OUT_OF_RANGE         ErrorCode = "OUT_OF_RANGE"
	PERMUTATION_FAILURE  ErrorCode = "PERMUTATION_FAILURE"
	INVALID_LENGTH       ErrorCode = "INVALID_LENGTH"
	INVALID_CHARACTER    ErrorCode = "INVALID_CHARACTER"
	INVALID_CHECKSUM     ErrorCode = "INVALID_CHECKSUM"
	AMBIGUOUS_INPUT      ErrorCode = "AMBIGUOUS_INPUT"
	TOO_MANY_CANDIDATES  ErrorCode = "TOO_MANY_CANDIDATES"
)

// Error is the single error type returned by this package. Retrieve it with
// errors.As and never match on the message text.
type Error struct {
	Code    ErrorCode
	Message string
	// SafeForCustomer is true when Message may be shown to an end user
	// unchanged. It never contains internal IDs.
	SafeForCustomer bool
}

func (e *Error) Error() string {
	return fmt.Sprintf("hrc: %s: %s", e.Code, e.Message)
}

func newError(code ErrorCode, message string, safe bool) *Error {
	return &Error{Code: code, Message: message, SafeForCustomer: safe}
}

func invalidProfile(reason string) *Error {
	return newError(INVALID_PROFILE, "invalid HRC profile: "+reason, false)
}
