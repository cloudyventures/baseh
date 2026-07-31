"""Fixed-length base-N encode and decode, spec sections 5.1 through 5.3."""

from __future__ import annotations

from .errors import INVALID_CHARACTER, OUT_OF_RANGE, HrcError


def alphabet_index(alphabet: str) -> dict:
    return {ch: i for i, ch in enumerate(alphabet)}


def encode_base_n(value: int, alphabet: str, length: int) -> str:
    """Fixed-length base-N encode, most significant digit first."""
    base = len(alphabet)
    capacity = base ** length
    if value < 0 or value >= capacity:
        raise HrcError(OUT_OF_RANGE, "value is outside the fixed-length capacity")
    out = [""] * length
    v = value
    for pos in range(length - 1, -1, -1):
        out[pos] = alphabet[v % base]
        v //= base
    return "".join(out)


def decode_base_n(text: str, alphabet: str, index: dict | None = None) -> int:
    base = len(alphabet)
    if index is None:
        index = alphabet_index(alphabet)
    value = 0
    for ch in text:
        digit = index.get(ch)
        if digit is None:
            raise HrcError(INVALID_CHARACTER, f"Symbol {ch!r} is not in the alphabet")
        value = value * base + digit
    return value
