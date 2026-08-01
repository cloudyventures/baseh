"""Frozen profile helpers, spec section 17."""

from __future__ import annotations

_BODY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_CHECKSUM_ALPHABET = "234679ACDEFGHJKMNPQRTUVWXY"
_ALIASES = {"O": "0", "I": "1", "L": "1"}


def baseh32_v1(
    key_bytes: bytes | None = None,
    key_id: str | None = None,
    rounds: int = 8,
) -> dict:
    """Frozen profile baseh32-v1: 6 body + 1 checksum, opt-in permutation.

    Assisted-support use. Structured single-substitution miss rate about 1.2%
    per position; see spec 6.3. Permutation is disabled unless key_bytes is
    supplied; supplying it enables feistel-v1 with key_id defaulting to
    "default" and rounds defaulting to 8.
    """
    if key_bytes is None:
        permutation = {"enabled": False}
    else:
        permutation = {
            "enabled": True,
            "algorithm": "feistel-v1",
            "keyId": key_id if key_id is not None else "default",
            "keyBytes": bytes(key_bytes),
            "rounds": rounds,
        }
    return {
        "profileId": "baseh32-v1",
        "bodyAlphabet": _BODY_ALPHABET,
        "bodyLength": 6,
        "checksumAlphabet": _CHECKSUM_ALPHABET,
        "checksumLength": 1,
        "caseSensitive": False,
        "separator": "",
        "grouping": [],
        "aliases": dict(_ALIASES),
        "permutation": permutation,
    }


def baseh32s_v1(
    key_bytes: bytes | None = None,
    key_id: str | None = None,
    rounds: int = 8,
) -> dict:
    """Frozen profile baseh32s-v1: 6 body + 2 checksum, opt-in permutation.

    Self-service use. Provably detects all single-symbol substitutions and
    all adjacent transpositions; see spec 6.3. Permutation is disabled unless
    key_bytes is supplied.
    """
    profile = baseh32_v1(key_bytes, key_id, rounds)
    profile["profileId"] = "baseh32s-v1"
    profile["checksumLength"] = 2
    return profile
