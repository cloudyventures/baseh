"""Zero-config facade: package-level encode/decode backed by a lazily-built
shared Baseh instance on the frozen expandable v1 tier, the recommended
starting point for new namespaces. Both functions mirror the instance API
exactly, including its error conventions (BasehError with a stable .code)."""

from __future__ import annotations

from .codec import Baseh, DecodeResult
from .profiles import baseh_expandable_v1

_default: Baseh | None = None


def _default_codec() -> Baseh:
    global _default
    if _default is None:
        _default = Baseh(baseh_expandable_v1())
    return _default


def encode(id: int) -> str:
    """Encode with the shared baseh-expandable-v1 codec."""
    return _default_codec().encode(id)


def decode(
    code: str,
    *,
    accept_spaces: bool = False,
    try_correction: bool = False,
    confusion_profile: str = "none",
    max_corrections: int = 1,
) -> DecodeResult:
    """Decode with the shared baseh-expandable-v1 codec."""
    return _default_codec().decode(
        code,
        accept_spaces=accept_spaces,
        try_correction=try_correction,
        confusion_profile=confusion_profile,
        max_corrections=max_corrections,
    )
