"""HRC (Human Reference Code) codec, Python implementation.

Public API mirrors spec section 12: Hrc codec class, HrcError with a stable
.code attribute and the frozen profile helpers hrc32_v1 and hrc32s_v1.
"""

from .codec import CONFUSION_MAPS, DecodeResult, Hrc, generate_candidates
from .errors import (
    AMBIGUOUS_INPUT,
    INVALID_CHARACTER,
    INVALID_CHECKSUM,
    INVALID_LENGTH,
    INVALID_PROFILE,
    OUT_OF_RANGE,
    PERMUTATION_FAILURE,
    TOO_MANY_CANDIDATES,
    HrcError,
)
from .profiles import hrc32_v1, hrc32s_v1

__all__ = [
    "Hrc",
    "HrcError",
    "DecodeResult",
    "CONFUSION_MAPS",
    "generate_candidates",
    "hrc32_v1",
    "hrc32s_v1",
    "INVALID_PROFILE",
    "OUT_OF_RANGE",
    "PERMUTATION_FAILURE",
    "INVALID_LENGTH",
    "INVALID_CHARACTER",
    "INVALID_CHECKSUM",
    "AMBIGUOUS_INPUT",
    "TOO_MANY_CANDIDATES",
]

__version__ = "1.0.0"
