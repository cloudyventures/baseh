"""Feistel-v1 reversible permutation, spec section 7.3.

Message bytes, half widths, low-N-bits truncation and cycle walking are
implemented exactly as written in section 7.3. The vectors in
vectors/feistel-vectors.json are the ground truth.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass

from .errors import PERMUTATION_FAILURE, BasehError


@dataclass(frozen=True)
class FeistelKey:
    profile_id: str
    key_bytes: bytes
    rounds: int


_TAG = b"BASEH-FEISTEL-V1"
_MAX_WALKS = 1000


def _bit_length(capacity: int) -> int:
    return (capacity - 1).bit_length()


def _low_bits(digest: bytes, n: int) -> int:
    """Interpret the first ceil(n/8) digest bytes as big-endian, mask to n bits."""
    byte_count = (n + 7) // 8
    value = int.from_bytes(digest[:byte_count], "big")
    return value & ((1 << n) - 1)


def _round_message(profile_id: str, round_number: int, right: int, wr: int) -> bytes:
    pid_bytes = profile_id.encode("ascii")
    right_bytes = right.to_bytes((wr + 7) // 8, "big")
    return (
        _TAG
        + b"\x00"
        + pid_bytes
        + b"\x00"
        + bytes([round_number])
        + right_bytes
    )


def _run_rounds(left: int, right: int, key, w0: int, w1: int) -> tuple:
    for i in range(key.rounds):
        even = i % 2 == 0
        wr = w1 if even else w0
        wl = w0 if even else w1
        digest = hmac.new(
            key.key_bytes, _round_message(key.profile_id, i, right, wr), hashlib.sha256
        ).digest()
        f = _low_bits(digest, wl)
        left, right = right, left ^ f
    return left, right


def _run_inverse(left: int, right: int, key, w0: int, w1: int) -> tuple:
    for i in range(key.rounds - 1, -1, -1):
        even = i % 2 == 0
        wr = w1 if even else w0
        wl = w0 if even else w1
        digest = hmac.new(
            key.key_bytes, _round_message(key.profile_id, i, left, wr), hashlib.sha256
        ).digest()
        f = _low_bits(digest, wl)
        left, right = right ^ f, left
    return left, right


def _split(value: int, w1: int) -> tuple:
    return value >> w1, value & ((1 << w1) - 1)


def _combine(left: int, right: int, w1: int) -> int:
    return (left << w1) | right


def permute(value: int, capacity: int, key) -> int:
    """Forward permutation with cycle walking, spec 7.3 steps 1-7."""
    bits = _bit_length(capacity)
    w1 = bits // 2
    w0 = bits - w1
    v = value
    for _ in range(_MAX_WALKS):
        left, right = _split(v, w1)
        left, right = _run_rounds(left, right, key, w0, w1)
        out = _combine(left, right, w1)
        if out < capacity:
            return out
        v = out
    raise BasehError(
        PERMUTATION_FAILURE, "Feistel cycle walking exceeded 1000 iterations", False
    )


def inverse_permute(value: int, capacity: int, key) -> int:
    """Inverse permutation with identical cycle walking, spec 7.3."""
    bits = _bit_length(capacity)
    w1 = bits // 2
    w0 = bits - w1
    v = value
    for _ in range(_MAX_WALKS):
        left, right = _split(v, w1)
        left, right = _run_inverse(left, right, key, w0, w1)
        out = _combine(left, right, w1)
        if out < capacity:
            return out
        v = out
    raise BasehError(
        PERMUTATION_FAILURE, "Feistel cycle walking exceeded 1000 iterations", False
    )
