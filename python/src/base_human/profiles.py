"""Frozen profile tiers, spec section 17.

Four tiers built from the full alphanumeric set with cumulative visual and
spoken strips:

    Minimum  36 symbols, no checksum           2,176,782,336 ids
    Light    31 symbols, 1 checksum              887,503,681 ids
    Medium   28 symbols, 1 checksum              481,890,304 ids (default)
    Heavy    26 symbols, 1 checksum              308,915,776 ids

All four are 6 body symbols, case-insensitive, run the default profanity
blocklist and keep the typed O/I/L aliases where possible. Minimum also
uses a hyphen delimiter; the rest have none. The _p variants are identical
but enable feistel-v1 permutation and require caller-supplied key material.

Each helper returns a freshly-built mutable profile dict on every call, so
callers can load a default and modify it.
"""

from __future__ import annotations

_OIL_ALIASES = {"O": "0", "I": "1", "L": "1"}

_TIERS = {
    "minimum": {
        "profileId": "baseh-minimum",
        "bodyAlphabet": "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        "checksumAlphabet": "",
        "checksumLength": 0,
        "separator": "-",
        "grouping": [3, 3],
        "aliases": {},
    },
    "light": {
        "profileId": "baseh-light",
        "bodyAlphabet": "0123456789ABCEFGHJKMNPQRSUVWXYZ",
        "checksumAlphabet": "234679ACEFGHJKMNPQRUVWXY",
        "checksumLength": 1,
        "separator": "",
        "grouping": [],
        "aliases": {**_OIL_ALIASES, "D": "B", "T": "P"},
    },
    "medium": {
        "profileId": "baseh-medium",
        "bodyAlphabet": "0123456789ACDEFGHJKMPQRUVXYZ",
        "checksumAlphabet": "234679ACDEFGHJKMPQRUVXY",
        "checksumLength": 1,
        "separator": "",
        "grouping": [],
        "aliases": {**_OIL_ALIASES, "T": "P", "N": "M", "W": "V"},
    },
    "heavy": {
        "profileId": "baseh-heavy",
        "bodyAlphabet": "0123456789ABCEFHJKMPQRVXYZ",
        "checksumAlphabet": "234679ACEFHJKMPQRUVXY",
        "checksumLength": 1,
        "separator": "",
        "grouping": [],
        "aliases": {
            **_OIL_ALIASES,
            "D": "B",
            "T": "P",
            "N": "M",
            "W": "V",
            "S": "F",
            "G": "C",
        },
    },
}


def _tier(name: str, permutation: dict, p_suffix: bool) -> dict:
    shape = _TIERS[name]
    return {
        "profileId": shape["profileId"] + ("-p" if p_suffix else "") + "-v1",
        "bodyAlphabet": shape["bodyAlphabet"],
        "bodyLength": 6,
        "checksumAlphabet": shape["checksumAlphabet"],
        "checksumLength": shape["checksumLength"],
        "caseSensitive": False,
        "separator": shape["separator"],
        "grouping": list(shape["grouping"]),
        "aliases": dict(shape["aliases"]),
        "permutation": permutation,
        "profanity": {"mode": "blocklist"},
    }


def _keyed_permutation(key_bytes: bytes, key_id: str, rounds: int) -> dict:
    return {
        "enabled": True,
        "algorithm": "feistel-v1",
        "keyId": key_id,
        "keyBytes": bytes(key_bytes),
        "rounds": rounds,
    }


def baseh_minimum_v1() -> dict:
    """Alphanumeric, no safety strips, no checksum, hyphen-delimited XXX-XXX."""
    return _tier("minimum", {"enabled": False}, False)


def baseh_minimum_p_v1(
    key_bytes: bytes, key_id: str = "default", rounds: int = 8
) -> dict:
    """baseh-minimum with feistel-v1 permutation."""
    return _tier("minimum", _keyed_permutation(key_bytes, key_id, rounds), True)


def baseh_light_v1() -> dict:
    """Visual light plus spoken light, one checksum symbol."""
    return _tier("light", {"enabled": False}, False)


def baseh_light_p_v1(
    key_bytes: bytes, key_id: str = "default", rounds: int = 8
) -> dict:
    """baseh-light with feistel-v1 permutation."""
    return _tier("light", _keyed_permutation(key_bytes, key_id, rounds), True)


def baseh_medium_v1() -> dict:
    """Visual medium plus spoken medium, one checksum symbol. The default."""
    return _tier("medium", {"enabled": False}, False)


def baseh_medium_p_v1(
    key_bytes: bytes, key_id: str = "default", rounds: int = 8
) -> dict:
    """baseh-medium with feistel-v1 permutation."""
    return _tier("medium", _keyed_permutation(key_bytes, key_id, rounds), True)


def baseh_heavy_v1() -> dict:
    """Conservative alphabet plus spoken heavy, one checksum symbol."""
    return _tier("heavy", {"enabled": False}, False)


def baseh_heavy_p_v1(
    key_bytes: bytes, key_id: str = "default", rounds: int = 8
) -> dict:
    """baseh-heavy with feistel-v1 permutation."""
    return _tier("heavy", _keyed_permutation(key_bytes, key_id, rounds), True)
