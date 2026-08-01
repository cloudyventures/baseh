"""Profile validation per spec section 2.2 and derived precomputed values."""

from __future__ import annotations

from dataclasses import dataclass

from .blocklist import effective_blocklist, strip_vowels
from .errors import INVALID_PROFILE, BasehError


def _fail(reason: str) -> None:
    raise BasehError(INVALID_PROFILE, f"Invalid baseH profile: {reason}", False)


def _is_ascii_char(ch: str) -> bool:
    return len(ch) == 1 and 0x20 <= ord(ch) <= 0x7E


def _is_ascii(text: str) -> bool:
    return all(0x20 <= ord(ch) <= 0x7E for ch in text)


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


@dataclass(frozen=True)
class PreparedPermutation:
    enabled: bool
    key_id: str = ""
    key_bytes: bytes = b""
    rounds: int = 8


@dataclass(frozen=True)
class PreparedProfile:
    """Validated profile with derived case-normalized values."""

    profile_id: str
    body_alphabet_norm: str
    checksum_alphabet_norm: str
    body_length: int
    checksum_length: int
    case_sensitive: bool
    separator: str
    grouping: tuple
    aliases_norm: dict
    permutation: PreparedPermutation
    checksum_modulus: int
    capacity: int
    blocklist: tuple


def _norm(case_sensitive: bool, ch: str) -> str:
    return ch if case_sensitive else ch.upper()


def prepare_profile(profile) -> PreparedProfile:
    """Validate a profile dict per spec 2.2. Raises BasehError INVALID_PROFILE."""
    if not isinstance(profile, dict):
        _fail("profile is required")

    profile_id = profile.get("profileId")
    if not isinstance(profile_id, str) or len(profile_id) == 0:
        _fail("profileId must be non-empty")
    if not _is_ascii(profile_id):
        _fail("profileId must be ASCII")

    case_sensitive = profile.get("caseSensitive") is True

    body_alphabet = profile.get("bodyAlphabet")
    if not isinstance(body_alphabet, str) or len(body_alphabet) < 2:
        _fail("bodyAlphabet needs at least two symbols")
    for ch in body_alphabet:
        if not _is_ascii_char(ch):
            _fail(f"body alphabet symbol is not single ASCII: {ch!r}")
    body_norm = "".join(_norm(case_sensitive, ch) for ch in body_alphabet)
    if len(set(body_norm)) != len(body_norm):
        _fail("body alphabet symbols must be unique after case normalization")

    body_length = profile.get("bodyLength")
    if not _is_int(body_length) or body_length < 1 or body_length > 32:
        _fail("bodyLength must be an integer from 1 through 32")

    checksum_length = profile.get("checksumLength")
    if not _is_int(checksum_length) or checksum_length < 0 or checksum_length > 8:
        _fail("checksumLength must be an integer from 0 through 8")

    checksum_alphabet = profile.get("checksumAlphabet") or ""
    if not isinstance(checksum_alphabet, str):
        _fail("checksumAlphabet must be a string")
    if checksum_length > 0:
        if len(checksum_alphabet) < 2:
            _fail("checksumAlphabet needs at least two symbols when checksumLength is positive")
        for ch in checksum_alphabet:
            if not _is_ascii_char(ch):
                _fail(f"checksum alphabet symbol is not single ASCII: {ch!r}")
    checksum_norm = "".join(_norm(case_sensitive, ch) for ch in checksum_alphabet)
    if len(set(checksum_norm)) != len(checksum_norm):
        _fail("checksum alphabet symbols must be unique after case normalization")

    # Spec 18. no-vowels strips vowels before every downstream rule; blocklist
    # only arms the encode-time scan.
    profanity = profile.get("profanity") or {"mode": "none"}
    if not isinstance(profanity, dict) or profanity.get("mode") not in (
        "none",
        "no-vowels",
        "blocklist",
    ):
        _fail("profanity mode must be none, no-vowels or blocklist")
    if profanity["mode"] == "no-vowels":
        body_norm = strip_vowels(body_norm)
        checksum_norm = strip_vowels(checksum_norm)
        if len(body_norm) < 2:
            _fail("no-vowels mode leaves the body alphabet with fewer than two symbols")
        if checksum_length > 0 and len(checksum_norm) < 2:
            _fail("no-vowels mode leaves the checksum alphabet with fewer than two symbols")
    blocklist = (
        effective_blocklist(profanity) if profanity["mode"] == "blocklist" else []
    )

    separator = profile.get("separator") or ""
    if not isinstance(separator, str):
        _fail("separator must be a string")
    for ch in separator:
        if ch in body_norm or ch in checksum_norm:
            _fail("separator must not occur in either alphabet")

    aliases = profile.get("aliases") or {}
    if not isinstance(aliases, dict):
        _fail("aliases must be a mapping")
    aliases_norm: dict = {}
    canonical_set = set(body_norm) | set(checksum_norm)
    for src, tgt in aliases.items():
        if not isinstance(src, str) or not _is_ascii_char(src):
            _fail(f"alias source is not single ASCII: {src!r}")
        if not isinstance(tgt, str) or not _is_ascii_char(tgt):
            _fail(f"alias target is not single ASCII: {tgt!r}")
        s_norm = _norm(case_sensitive, src)
        t_norm = _norm(case_sensitive, tgt)
        if s_norm in canonical_set:
            _fail(f"alias source {src!r} is already a canonical symbol")
        if t_norm not in canonical_set:
            _fail(f"alias target {tgt!r} is not a canonical symbol")
        if s_norm in aliases_norm:
            _fail(f"duplicate alias source {s_norm!r} after case normalization")
        if any(_norm(case_sensitive, key) == t_norm for key in aliases):
            _fail(f"alias chain forbidden: target {t_norm} is also an alias source")
        aliases_norm[s_norm] = t_norm

    grouping = profile.get("grouping")
    if not isinstance(grouping, (list, tuple)):
        _fail("grouping must be empty when separator is empty")
    if separator == "":
        if len(grouping) != 0:
            _fail("grouping must be empty when separator is empty")
    else:
        group_sum = 0
        for g in grouping:
            if not _is_int(g) or g < 1:
                _fail("group sizes must sum to bodyLength + checksumLength")
            group_sum += g
        if group_sum != body_length + checksum_length:
            _fail("group sizes must sum to bodyLength + checksumLength")

    permutation = profile.get("permutation") or {"enabled": False}
    if not isinstance(permutation, dict):
        _fail("permutation must be a mapping")
    if permutation.get("enabled"):
        if permutation.get("algorithm") != "feistel-v1":
            _fail("unknown permutation algorithm")
        key_id = permutation.get("keyId")
        if not isinstance(key_id, str) or len(key_id) == 0:
            _fail("permutation requires a keyId")
        key_bytes = permutation.get("keyBytes")
        if not isinstance(key_bytes, (bytes, bytearray)) or len(key_bytes) == 0:
            _fail("permutation requires key material")
        rounds = permutation.get("rounds")
        if not _is_int(rounds) or rounds < 4 or rounds > 16 or rounds % 2 != 0:
            _fail("Feistel rounds must be an even integer from 4 through 16")
        perm = PreparedPermutation(
            enabled=True,
            key_id=key_id,
            key_bytes=bytes(key_bytes),
            rounds=rounds,
        )
    else:
        perm = PreparedPermutation(enabled=False)

    modulus_base = len(checksum_norm) if checksum_norm else 1
    return PreparedProfile(
        profile_id=profile_id,
        body_alphabet_norm=body_norm,
        checksum_alphabet_norm=checksum_norm,
        body_length=body_length,
        checksum_length=checksum_length,
        case_sensitive=case_sensitive,
        separator=separator,
        grouping=tuple(grouping),
        aliases_norm=aliases_norm,
        permutation=perm,
        checksum_modulus=modulus_base ** checksum_length,
        capacity=len(body_norm) ** body_length,
        blocklist=tuple(blocklist),
    )
