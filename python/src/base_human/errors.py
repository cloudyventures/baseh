"""Error type and codes defined by the BaseH codec specification."""

INVALID_PROFILE = "INVALID_PROFILE"
OUT_OF_RANGE = "OUT_OF_RANGE"
PERMUTATION_FAILURE = "PERMUTATION_FAILURE"
INVALID_LENGTH = "INVALID_LENGTH"
INVALID_CHARACTER = "INVALID_CHARACTER"
INVALID_CHECKSUM = "INVALID_CHECKSUM"
AMBIGUOUS_INPUT = "AMBIGUOUS_INPUT"
TOO_MANY_CANDIDATES = "TOO_MANY_CANDIDATES"
BLOCKED_CODE = "BLOCKED_CODE"

ERROR_CODES = frozenset(
    {
        INVALID_PROFILE,
        OUT_OF_RANGE,
        PERMUTATION_FAILURE,
        INVALID_LENGTH,
        INVALID_CHARACTER,
        INVALID_CHECKSUM,
        AMBIGUOUS_INPUT,
        TOO_MANY_CANDIDATES,
        BLOCKED_CODE,
    }
)


class BasehError(Exception):
    """Codec error carrying a stable, machine-readable code."""

    def __init__(self, code: str, message: str, safe_for_customer: bool = True) -> None:
        super().__init__(message)
        if code not in ERROR_CODES:
            raise ValueError(f"unknown BaseH error code: {code!r}")
        self.code = code
        self.safe_for_customer = safe_for_customer
