"""baseH codec, Python implementation.

Public API mirrors spec section 12: the Baseh codec class, BasehError with a
stable .code attribute and the frozen profile tier helpers (baseh_medium_v1
is the default tier; the _p variants enable feistel-v1 permutation).
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
from .profiles import (
    baseh_heavy_p_v1,
    baseh_heavy_v1,
    baseh_light_p_v1,
    baseh_light_v1,
    baseh_medium_p_v1,
    baseh_medium_v1,
    baseh_minimum_p_v1,
    baseh_minimum_v1,
)
from .zero import from_code, to_code

__all__ = [
    "Baseh",
    "BasehError",
    "DecodeResult",
    "CONFUSION_MAPS",
    "DEFAULT_BLOCKLIST",
    "generate_candidates",
    "baseh_minimum_v1",
    "baseh_minimum_p_v1",
    "baseh_light_v1",
    "baseh_light_p_v1",
    "baseh_medium_v1",
    "baseh_medium_p_v1",
    "baseh_heavy_v1",
    "baseh_heavy_p_v1",
    "INVALID_PROFILE",
    "OUT_OF_RANGE",
    "PERMUTATION_FAILURE",
    "INVALID_LENGTH",
    "INVALID_CHARACTER",
    "INVALID_CHECKSUM",
    "AMBIGUOUS_INPUT",
    "TOO_MANY_CANDIDATES",
    "BLOCKED_CODE",
    "to_code",
    "from_code",
]

__version__ = "1.0.0"
