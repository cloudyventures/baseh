"""Zero-config pair over the frozen baseh-medium-v1 profile.

No profile object, no key: just the two functions an application needs
when it does not want to think about configuration.

    to_code(id)    -> "UJEA-4MA7"
    from_code(code) -> id

to_code accepts an int or a decimal string of digits. from_code strips
every whitespace character (edges and internal), accepts lowercase and
the typed aliases (O, I, L) and returns the id as an int. Any invalid
input raises BasehError, including the rare BLOCKED_CODE identifiers
that spell a blocklisted word; no correction attempts are ever made.
"""

from __future__ import annotations

import re

from .codec import Baseh
from .profiles import baseh_medium_v1

_DECIMAL = re.compile(r"^[0-9]+$")
_WHITESPACE = re.compile(r"\s+")

_ZERO = Baseh(baseh_medium_v1())


def _to_int(id: object) -> int:
    if isinstance(id, bool):
        raise TypeError(
            "to_code expects a non-negative int or a decimal string"
        )
    if isinstance(id, int):
        if id < 0:
            raise ValueError("to_code expects a non-negative id")
        return id
    if isinstance(id, str) and _DECIMAL.match(id):
        return int(id)
    raise TypeError("to_code expects a non-negative int or a decimal string")


def to_code(id: object) -> str:
    """Encode an identifier with the zero-config Medium profile."""
    return _ZERO.encode(_to_int(id))


def from_code(code: str) -> int:
    """Decode a code from the zero-config Medium profile back to its id."""
    if not isinstance(code, str):
        raise TypeError("from_code expects a string")
    return _ZERO.decode(_WHITESPACE.sub("", code)).id
