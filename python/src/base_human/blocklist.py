"""Profanity safety primitives, spec section 18."""

from __future__ import annotations

import re

from .errors import INVALID_PROFILE, BasehError

# Spec 18.2 default list. Deliberately small; applications extend it.
DEFAULT_BLOCKLIST = (
    "CRAP", "TWAT", "SHAG", "DAMN", "FCK", "FUC",
    "SHT", "CNT", "TWT", "DCK", "AZZ", "BCH",
)

_WORD = re.compile(r"^[A-Za-z]{2,32}$")
_VOWELS = frozenset("AEIOU")


def effective_blocklist(profanity: dict) -> list:
    """Spec 18.2: replacement semantics, then augmentation, uppercased and
    deduplicated. Raises BasehError INVALID_PROFILE on a malformed entry."""
    base = list(profanity["words"]) if "words" in profanity else list(DEFAULT_BLOCKLIST)
    words = base + list(profanity.get("extraWords") or [])
    out: list = []
    for word in words:
        if not isinstance(word, str) or not _WORD.match(word):
            raise BasehError(
                INVALID_PROFILE,
                "Invalid baseH profile: blocklist entries must be 2 through 32 ASCII letters",
                False,
            )
        upper = word.upper()
        if upper not in out:
            out.append(upper)
    return out


def strip_vowels(alphabet_norm: str) -> str:
    """Spec 18.1: vowels removed for no-vowels mode, applied after case
    normalization."""
    return "".join(ch for ch in alphabet_norm if ch not in _VOWELS)
