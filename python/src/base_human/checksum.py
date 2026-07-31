"""Version 1 rolling polynomial checksum, spec section 6.2."""

from __future__ import annotations

from .basen import alphabet_index, encode_base_n
from .errors import INVALID_CHARACTER, HrcError
from .profile import PreparedProfile

_INITIAL_STATE = 17
_MULTIPLIER = 37


def checksum_value(profile: PreparedProfile, body: str, body_index: dict) -> int:
    """Return the checksum value in [0, modulus)."""
    modulus = profile.checksum_modulus
    state = _INITIAL_STATE
    for byte in profile.profile_id.encode("ascii"):
        state = (state * _MULTIPLIER + byte + 1) % modulus
    state = (state * _MULTIPLIER) % modulus
    for pos, ch in enumerate(body):
        value = body_index.get(ch)
        if value is None:
            raise HrcError(
                INVALID_CHARACTER, f"Symbol {ch!r} is not in the body alphabet"
            )
        state = (state * _MULTIPLIER + value + pos + 1) % modulus
    return state


def calculate_checksum(profile: PreparedProfile, body: str) -> str:
    """Compute the expected checksum string for a normalized body."""
    if profile.checksum_length == 0:
        return ""
    index = alphabet_index(profile.body_alphabet_norm)
    value = checksum_value(profile, body, index)
    return encode_base_n(value, profile.checksum_alphabet_norm, profile.checksum_length)
