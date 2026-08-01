"""BaseH codec, Python implementation.

Public API mirrors spec section 12: the Baseh codec class, BasehError with a
stable .code attribute and the frozen profile helpers baseh32_v1 and
baseh32s_v1.
"""

from .blocklist import DEFAULT_BLOCKLIST
from .codec import CONFUSION_MAPS, Baseh, DecodeResult, generate_candidates
from .errors import (
    AMBIGUOUS_INPUT,
    BLOCKED_CODE,
    INVALID_CHARACTER,
    INVALID_CHECKSUM,
    INVALID_LENGTH,
    INVALID_PROFILE,
    OUT_OF_RANGE,
    PERMUTATION_FAILURE,
    TOO_MANY_CANDIDATES,
    BasehError,
)
from .profiles import baseh32_v1, baseh32s_v1

__all__ = [
    "Baseh",
    "BasehError",
    "DecodeResult",
    "CONFUSION_MAPS",
    "DEFAULT_BLOCKLIST",
    "generate_candidates",
    "baseh32_v1",
    "baseh32s_v1",
    "INVALID_PROFILE",
    "OUT_OF_RANGE",
    "PERMUTATION_FAILURE",
    "INVALID_LENGTH",
    "INVALID_CHARACTER",
    "INVALID_CHECKSUM",
    "AMBIGUOUS_INPUT",
    "TOO_MANY_CANDIDATES",
    "BLOCKED_CODE",
]

__version__ = "1.0.0"
