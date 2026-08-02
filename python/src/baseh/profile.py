"""Profile validation per spec section 2.2 and derived precomputed values."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType

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
    mode: str
    min_length: int
    separator_min_length: int
    body_alphabet: str
    checksum_alphabet: str
    aliases: MappingProxyType
    body_alphabet_norm: str
    checksum_alphabet_norm: str
    body_length: int
    checksum_length: int
    case_sensitive: bool
    separator: str
    grouping: tuple
    aliases_norm: MappingProxyType
    permutation: PreparedPermutation
    checksum_modulus: int
    capacity: int
    blocklist: tuple
    max_repetition: int
    short_checksum_length: int
    short_checksum_until: int


def effective_checksum_length(profile: PreparedProfile, length: int) -> int:
    """Spec 22. The checksum length that applies to a generation of the given
    total length: ``short_checksum_length`` at or below ``short_checksum_until``,
    ``checksum_length`` above it (and always in fixed mode)."""
    if (
        profile.mode == "expandable"
        and profile.short_checksum_until > 0
        and length <= profile.short_checksum_until
    ):
        return profile.short_checksum_length
    return profile.checksum_length


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

    # Spec 2.2/19.9. A persisted or frozen profile declares its mode; profiles
    # built before the mode field existed are fixed, so the frozen vectors keep
    # matching byte for byte.
    mode = profile.get("mode") or "fixed"
    if mode not in ("fixed", "expandable"):
        _fail("mode must be fixed or expandable")

    case_sensitive = profile.get("caseSensitive") is True

    body_alphabet = profile.get("bodyAlphabet")
    if not isinstance(body_alphabet, str) or len(body_alphabet) < 2:
        _fail("bodyAlphabet needs at least two symbols")
    for ch in body_alphabet:
        if not _is_ascii_char(ch):
            _fail(f"body alphabet symbol is not single ASCII: {ch!r}")
    body_norm = "".join(_norm(case_sensitive, ch) for ch in body_alphabet)
    # Spec 19.2: in expandable mode the zero ban strips 0 and O from the body
    # alphabet silently, before any other validation, exactly like the
    # no-vowels strip of section 18.1.
    if mode == "expandable":
        body_norm = "".join(ch for ch in body_norm if ch not in ("0", "O"))
    if len(set(body_norm)) != len(body_norm):
        _fail("body alphabet symbols must be unique after case normalization")

    body_length = profile.get("bodyLength")
    if mode == "fixed":
        if not _is_int(body_length) or body_length < 1 or body_length > 32:
            _fail("bodyLength must be an integer from 1 through 32")
    elif body_length is None:
        body_length = 0

    min_length = profile.get("minLength")
    if min_length is None:
        min_length = 4
    # JS parity (profile.ts): an explicit minLength of 0 is rejected in both
    # modes, and a non-integer fails cleanly rather than blowing up later.
    if not _is_int(min_length) or min_length < 1:
        _fail("minLength must be an integer of at least 1")
    separator_min_length = profile.get("separatorMinLength")
    if separator_min_length is None:
        separator_min_length = 0
    if mode == "fixed" and separator_min_length != 0:
        _fail("separatorMinLength must be 0 in fixed mode")

    checksum_length = profile.get("checksumLength")
    if not _is_int(checksum_length) or checksum_length < 0 or checksum_length > 8:
        _fail("checksumLength must be an integer from 0 through 8")
    if mode == "expandable":
        if min_length <= checksum_length:
            _fail("minLength must be greater than checksumLength")
        if not _is_int(separator_min_length) or separator_min_length < 0:
            _fail("separatorMinLength must be an integer of at least 0")

    # Spec 22. The short checksum is expandable-only. The window field is the
    # switch: a shortChecksumUntil of 0 or absent turns the feature off (the
    # codebase convention, like maxRepetition), and a length without a window
    # is INVALID_PROFILE.
    short_checksum_length = profile.get("shortChecksumLength")
    if short_checksum_length is None:
        short_checksum_length = 0
    short_checksum_until = profile.get("shortChecksumUntil")
    if short_checksum_until is None:
        short_checksum_until = 0
    if mode == "fixed":
        if short_checksum_length != 0 or short_checksum_until != 0:
            _fail("shortChecksumLength and shortChecksumUntil are expandable-mode only")
    elif short_checksum_until != 0:
        if not _is_int(profile.get("shortChecksumUntil")) or short_checksum_until < min_length:
            _fail("shortChecksumUntil must be an integer of at least minLength")
        # Beyond 8 the window would swallow nearly every practical code, and
        # long codes genuinely want two checksum symbols.
        if short_checksum_until > 8:
            _fail("shortChecksumUntil must be at most 8")
        if (
            not _is_int(short_checksum_length)
            or short_checksum_length < 0
            or short_checksum_length >= checksum_length
        ):
            _fail("shortChecksumLength must be an integer from 0 through checksumLength - 1")
        if min_length <= short_checksum_length:
            _fail("minLength must be greater than shortChecksumLength")
    elif short_checksum_length != 0:
        _fail("shortChecksumLength requires shortChecksumUntil")

    checksum_alphabet = profile.get("checksumAlphabet") or ""
    if not isinstance(checksum_alphabet, str):
        _fail("checksumAlphabet must be a string")
    checksum_norm = "".join(_norm(case_sensitive, ch) for ch in checksum_alphabet)
    if mode == "expandable":
        # Spec 19.3: the checksum alphabet is derived, "0" followed by the
        # body alphabet in order. The configured checksumAlphabet is not
        # consulted; it is set after every body strip below.
        checksum_norm = ""
    elif checksum_length > 0:
        if len(checksum_alphabet) < 2:
            _fail("checksumAlphabet needs at least two symbols when checksumLength is positive")
        for ch in checksum_alphabet:
            if not _is_ascii_char(ch):
                _fail(f"checksum alphabet symbol is not single ASCII: {ch!r}")
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
        if mode == "fixed" and checksum_length > 0 and len(checksum_norm) < 2:
            _fail("no-vowels mode leaves the checksum alphabet with fewer than two symbols")
    if mode == "expandable":
        # Spec 19.3: derived after every body strip (zero ban, no-vowels) so
        # all downstream rules — modulus, separator collision, alias targets —
        # see the final alphabets.
        checksum_norm = "0" + body_norm
    if len(body_norm) < 2:
        _fail("body alphabet needs at least two symbols after preparation")
    blocklist = (
        effective_blocklist(profanity) if profanity["mode"] == "blocklist" else []
    )

    # Spec 21: 0 disables the filter; an active filter needs a floor of 3 —
    # banning pairs (2) would destroy roughly 9% of every generation.
    max_repetition = profile.get("maxRepetition")
    if max_repetition is None:
        max_repetition = 0
    if not _is_int(max_repetition) or max_repetition < 0 or (
        0 < max_repetition < 3
    ):
        _fail("maxRepetition must be 0 (off) or an integer of at least 3")

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
        # Spec 3.2: an alias must never map two distinct canonical symbols
        # into one value. Fixed mode rejects a canonical alias source
        # outright. In expandable mode the frozen tier (spec 17.1) carries
        # aliases whose sources are canonical body symbols (T, N, W stay in
        # the body alphabet); the canonical symbol wins at normalization,
        # making those entries inert instead of destructive.
        if mode == "fixed" and s_norm in canonical_set:
            _fail(f"alias source {src!r} is already a canonical symbol")
        if t_norm not in canonical_set:
            _fail(f"alias target {tgt!r} is not a canonical symbol")
        if s_norm in aliases_norm:
            _fail(f"duplicate alias source {s_norm!r} after case normalization")
        if any(_norm(case_sensitive, key) == t_norm for key in aliases):
            _fail(f"alias chain forbidden: target {t_norm} is also an alias source")
        aliases_norm[s_norm] = t_norm

    grouping = profile.get("grouping")
    if not isinstance(grouping, list | tuple):
        _fail("grouping must be a list of group sizes")
    if separator == "":
        if len(grouping) != 0:
            _fail("grouping must be empty when separator is empty")
    elif mode == "expandable":
        # Spec 19.5: the balanced grouping rule is a pure function of the
        # total length, so a configurable grouping is meaningless in
        # expandable mode.
        if len(grouping) != 0:
            _fail("grouping must be empty in expandable mode")
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
        if not isinstance(key_bytes, bytes | bytearray) or len(key_bytes) == 0:
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
        mode=mode,
        min_length=min_length,
        separator_min_length=separator_min_length,
        body_alphabet=body_alphabet,
        checksum_alphabet=checksum_alphabet,
        aliases=MappingProxyType(dict(aliases)),
        body_alphabet_norm=body_norm,
        checksum_alphabet_norm=checksum_norm,
        body_length=body_length,
        checksum_length=checksum_length,
        case_sensitive=case_sensitive,
        separator=separator,
        grouping=tuple(grouping),
        aliases_norm=MappingProxyType(aliases_norm),
        permutation=perm,
        checksum_modulus=modulus_base ** checksum_length,
        capacity=len(body_norm) ** body_length,
        blocklist=tuple(blocklist),
        max_repetition=max_repetition,
        short_checksum_length=short_checksum_length,
        short_checksum_until=short_checksum_until,
    )
