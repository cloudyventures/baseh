//! Error codes defined by the BaseH codec specification (spec section 13).

use std::fmt;

/// The error codes defined by the specification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    InvalidProfile,
    OutOfRange,
    PermutationFailure,
    InvalidLength,
    InvalidCharacter,
    InvalidChecksum,
    AmbiguousInput,
    TooManyCandidates,
    BlockedCode,
}

impl ErrorCode {
    /// The serialized form used by the spec, e.g. "INVALID_PROFILE".
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::InvalidProfile => "INVALID_PROFILE",
            ErrorCode::OutOfRange => "OUT_OF_RANGE",
            ErrorCode::PermutationFailure => "PERMUTATION_FAILURE",
            ErrorCode::InvalidLength => "INVALID_LENGTH",
            ErrorCode::InvalidCharacter => "INVALID_CHARACTER",
            ErrorCode::InvalidChecksum => "INVALID_CHECKSUM",
            ErrorCode::AmbiguousInput => "AMBIGUOUS_INPUT",
            ErrorCode::TooManyCandidates => "TOO_MANY_CANDIDATES",
            ErrorCode::BlockedCode => "BLOCKED_CODE",
        }
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for ErrorCode {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "INVALID_PROFILE" => Ok(ErrorCode::InvalidProfile),
            "OUT_OF_RANGE" => Ok(ErrorCode::OutOfRange),
            "PERMUTATION_FAILURE" => Ok(ErrorCode::PermutationFailure),
            "INVALID_LENGTH" => Ok(ErrorCode::InvalidLength),
            "INVALID_CHARACTER" => Ok(ErrorCode::InvalidCharacter),
            "INVALID_CHECKSUM" => Ok(ErrorCode::InvalidChecksum),
            "AMBIGUOUS_INPUT" => Ok(ErrorCode::AmbiguousInput),
            "TOO_MANY_CANDIDATES" => Ok(ErrorCode::TooManyCandidates),
            "BLOCKED_CODE" => Ok(ErrorCode::BlockedCode),
            _ => Err(()),
        }
    }
}

/// The error type returned by every fallible codec operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BasehError {
    pub code: ErrorCode,
    pub message: String,
    /// True when the message may be shown to an end user unchanged.
    pub safe_for_customer: bool,
}

impl BasehError {
    pub fn new(code: ErrorCode, message: impl Into<String>, safe_for_customer: bool) -> Self {
        BasehError {
            code,
            message: message.into(),
            safe_for_customer,
        }
    }

    /// Convenience for customer-safe errors (the common case).
    pub fn customer(code: ErrorCode, message: impl Into<String>) -> Self {
        BasehError::new(code, message, true)
    }
}

impl fmt::Display for BasehError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for BasehError {}
