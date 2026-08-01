"""baseH codec, Python implementation.

Public API mirrors spec section 12: the Baseh codec class, BasehError with a
stable .code attribute and the frozen profile tier helpers (baseh_medium_v1
is the default tier). The plain tiers permute with the frozen published key
FROZEN_KEY_BYTES; the _p variants take caller-supplied key material instead.
"""

from .blocklist import DEFAULT_BLOCKLIST
from .codec import (
    CONFUSION_MAPS,
    Baseh,
    DecodeResult,
    expandable_grouping,
    generate_candidates,
    generation_base,
    generation_capacity,
    generation_for_id,
)
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
from .facade import decode, encode
from .profile import effective_checksum_length
from .profiles import (
    FROZEN_KEY_BYTES,
    baseh_expandable_p_v1,
    baseh_expandable_v1,
    baseh_heavy_p_v1,
    baseh_heavy_v1,
    baseh_light_p_v1,
    baseh_light_v1,
    baseh_medium_p_v1,
    baseh_medium_v1,
    baseh_minimum_p_v1,
    baseh_minimum_v1,
)
__all__ = [
    "Baseh",
    "BasehError",
    "DecodeResult",
    "CONFUSION_MAPS",
    "DEFAULT_BLOCKLIST",
    "generate_candidates",
    "expandable_grouping",
    "generation_base",
    "generation_capacity",
    "generation_for_id",
    "effective_checksum_length",
    "encode",
    "decode",
    "FROZEN_KEY_BYTES",
    "baseh_expandable_v1",
    "baseh_expandable_p_v1",
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
]

__version__ = "2.0.0"
