"""Frozen profile tiers, spec section 17.

Four tiers built from the full alphanumeric set with cumulative visual and
spoken strips; the spoken strips interact with the visual ones exactly as
the web tools derive them, so the tool capacities match.

    Minimum  36 symbols, no checksum, XXX-XXX      2,176,782,336 ids
    Light    31 symbols, 2 checksums, XXXX-XXXX      887,503,681 ids
    Medium   28 symbols, 2 checksums, XXXX-XXXX      481,890,304 ids (default)
    Heavy    26 symbols, 2 checksums, XXXX-XXXX      308,915,776 ids

All four keep the typed O/I/L aliases where possible, use a hyphen
delimiter at the midpoint and run the default profanity blocklist. Every
tier permutes with the frozen published key (FROZEN_KEY_BYTES below): the
key is public, so the permutation obscures sequence but is not secrecy.
The _p variants are identical but permute with caller-supplied key
material instead.

Each helper returns a freshly-built mutable profile dict on every call, so
callers can load a default and modify it.
"""

from __future__ import annotations

# The frozen published permutation key. Public by design: it makes issued
# codes look non-sequential but offers no secrecy, since anyone can read it
# here. Never swap it on a live namespace; codes only decode with the key
# they were issued under. Use the _p variants to supply private key material.
FROZEN_KEY_BYTES = b"baseh-frozen-key-v1"

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
        "checksumLength": 2,
        "separator": "-",
        "grouping": [4, 4],
        "aliases": {**_OIL_ALIASES, "D": "B", "T": "P"},
    },
    "medium": {
        "profileId": "baseh-medium",
        "bodyAlphabet": "0123456789ACDEFGHJKMPQRUVXYZ",
        "checksumAlphabet": "234679ACDEFGHJKMPQRUVXY",
        "checksumLength": 2,
        "separator": "-",
        "grouping": [4, 4],
        # B and S are dropped for looking like 8 and 5; since they can never
        # be issued, a typed B is always an 8 and a typed S always a 5.
        "aliases": {**_OIL_ALIASES, "B": "8", "S": "5", "T": "P", "N": "M", "W": "V"},
    },
    "heavy": {
        "profileId": "baseh-heavy",
        "bodyAlphabet": "0123456789ABCEFHJKMPQRVXYZ",
        "checksumAlphabet": "234679ACEFHJKMPQRUVXY",
        "checksumLength": 2,
        "separator": "-",
        "grouping": [4, 4],
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


def _frozen_permutation() -> dict:
    """Permutation every plain tier applies, built from the frozen published key."""
    return _keyed_permutation(FROZEN_KEY_BYTES, "frozen", 8)


def baseh_minimum_v1() -> dict:
    """Alphanumeric, no safety strips, no checksum, hyphen-delimited XXX-XXX."""
    return _tier("minimum", _frozen_permutation(), False)


def baseh_minimum_p_v1(
    key_bytes: bytes, key_id: str = "default", rounds: int = 8
) -> dict:
    """baseh-minimum permuted with caller-supplied key material."""
    return _tier("minimum", _keyed_permutation(key_bytes, key_id, rounds), True)


def baseh_light_v1() -> dict:
    """Visual light plus spoken light, two checksum symbols, hyphen-delimited."""
    return _tier("light", _frozen_permutation(), False)


def baseh_light_p_v1(
    key_bytes: bytes, key_id: str = "default", rounds: int = 8
) -> dict:
    """baseh-light permuted with caller-supplied key material."""
    return _tier("light", _keyed_permutation(key_bytes, key_id, rounds), True)


def baseh_medium_v1() -> dict:
    """Visual medium plus spoken medium, two checksum symbols, hyphen-delimited. The default."""
    return _tier("medium", _frozen_permutation(), False)


def baseh_medium_p_v1(
    key_bytes: bytes, key_id: str = "default", rounds: int = 8
) -> dict:
    """baseh-medium permuted with caller-supplied key material."""
    return _tier("medium", _keyed_permutation(key_bytes, key_id, rounds), True)


_EXPANDABLE_BODY = "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ"


def _expandable_tier(permutation: dict, p_suffix: bool) -> dict:
    """Spec 17.1. The frozen expandable tier: four characters while the
    namespace is small, gaining one symbol automatically as issuance climbs
    past each generation's capacity. The body alphabet is the full
    alphanumeric set minus 0/O (the zero ban, spec 19.2); the checksum
    alphabet derives as "0" plus the body (35 symbols, modulus 1225). The
    hyphen appears from six characters up, grouped right-anchored by the
    [4, 4] pattern."""
    return {
        "profileId": "baseh-expandable" + ("-p" if p_suffix else "") + "-v1",
        "mode": "expandable",
        "bodyAlphabet": _EXPANDABLE_BODY,
        "minLength": 4,
        "checksumAlphabet": "0" + _EXPANDABLE_BODY,
        "checksumLength": 2,
        "caseSensitive": False,
        "separator": "-",
        "separatorMinLength": 6,
        "grouping": [4, 4],
        "aliases": {**_OIL_ALIASES, "T": "P", "N": "M", "W": "V"},
        "permutation": permutation,
        "profanity": {"mode": "blocklist"},
    }


def baseh_expandable_v1() -> dict:
    """The frozen expandable tier; the recommended starting point for new namespaces."""
    return _expandable_tier(_frozen_permutation(), False)


def baseh_expandable_p_v1(
    key_bytes: bytes, key_id: str = "default", rounds: int = 8
) -> dict:
    """baseh-expandable permuted with caller-supplied key material."""
    return _expandable_tier(_keyed_permutation(key_bytes, key_id, rounds), True)


def baseh_heavy_v1() -> dict:
    """Conservative alphabet plus spoken heavy, two checksum symbols, hyphen-delimited."""
    return _tier("heavy", _frozen_permutation(), False)


def baseh_heavy_p_v1(
    key_bytes: bytes, key_id: str = "default", rounds: int = 8
) -> dict:
    """baseh-heavy permuted with caller-supplied key material."""
    return _tier("heavy", _keyed_permutation(key_bytes, key_id, rounds), True)
