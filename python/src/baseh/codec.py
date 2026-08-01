"""Full encode and decode flows, spec sections 8, 9, 10, 11 and 12."""

from __future__ import annotations

from dataclasses import dataclass

from .basen import alphabet_index, decode_base_n, encode_base_n
from .checksum import calculate_checksum
from .errors import (
    AMBIGUOUS_INPUT,
    BLOCKED_CODE,
    INVALID_CHARACTER,
    INVALID_CHECKSUM,
    INVALID_LENGTH,
    OUT_OF_RANGE,
    TOO_MANY_CANDIDATES,
    BasehError,
)
from .feistel import FeistelKey, inverse_permute, permute
from .profile import PreparedProfile, prepare_profile

# Built-in spoken-confusion candidate maps, spec 3.3. Body symbols only.
CONFUSION_MAPS = {
    "light": {"B": ["D"], "D": ["B"], "P": ["T"], "T": ["P"]},
    "medium": {
        "B": ["D"], "D": ["B"], "P": ["T"], "T": ["P"],
        "M": ["N"], "N": ["M"], "V": ["W"], "W": ["V"],
    },
    "heavy": {
        "B": ["D"], "D": ["B"], "P": ["T"], "T": ["P"],
        "M": ["N"], "N": ["M"], "V": ["W"], "W": ["V"],
        "F": ["S"], "S": ["F"], "C": ["G"], "G": ["C"],
    },
}

_ASCII_WS = "\t\n\v\f\r "
_MAX_CANDIDATES = 64


@dataclass(frozen=True)
class DecodeResult:
    id: int
    canonical_code: str
    corrected: bool


def normalize(input: str, profile: PreparedProfile, accept_spaces: bool = False) -> str:
    """Spec 3.1 normalization, steps 1-7. Returns the raw unformatted string."""
    if not isinstance(input, str):
        raise BasehError(INVALID_CHARACTER, "input must be a string")
    s = input.strip(_ASCII_WS)
    if profile.separator:
        s = s.replace(profile.separator, "")
    if accept_spaces:
        s = s.replace(" ", "")
    if not profile.case_sensitive:
        s = s.upper()
    if profile.aliases_norm:
        s = "".join(profile.aliases_norm.get(ch, ch) for ch in s)
    allowed = set(profile.body_alphabet_norm) | set(profile.checksum_alphabet_norm)
    for ch in s:
        if ch not in allowed:
            raise BasehError(INVALID_CHARACTER, f"Symbol {ch!r} is not accepted")
    expected = profile.body_length + profile.checksum_length
    # Spec 3.4: a code that lost leading zero body symbols is re-padded with
    # the body zero symbol. The checksum symbols always remain, so the split
    # point is unambiguous. A fully stripped no-checksum code would be empty
    # and stays a length error.
    if len(s) < expected and len(s) >= max(profile.checksum_length, 1):
        zero = profile.body_alphabet_norm[0]
        s = zero * (expected - len(s)) + s
    if len(s) != expected:
        raise BasehError(INVALID_LENGTH, f"Expected {expected} symbols, got {len(s)}")
    return s


def format_raw(raw: str, profile: PreparedProfile) -> str:
    if not profile.separator:
        return raw
    parts = []
    offset = 0
    for size in profile.grouping:
        parts.append(raw[offset : offset + size])
        offset += size
    return profile.separator.join(parts)


def generate_candidates(body: str, confusion_map: dict, max_edits: int = 1) -> list:
    """Spec 10. Substitution-only candidate generation, capped and deduplicated."""
    if max_edits == 0:
        return []
    results: set = set()
    for pos, source in enumerate(body):
        for replacement in confusion_map.get(source, ()):
            candidate = body[:pos] + replacement + body[pos + 1 :]
            results.add(candidate)
            if len(results) > _MAX_CANDIDATES:
                raise BasehError(
                    TOO_MANY_CANDIDATES,
                    "Candidate generation exceeded 64 entries",
                    False,
                )
    return list(results)


class Baseh:
    """Codec bound to one validated profile. The profile is validated once at
    construction per spec 2.2, never per encode or decode."""

    def __init__(self, profile: dict) -> None:
        if isinstance(profile, PreparedProfile):
            self._profile = profile
        else:
            self._profile = prepare_profile(profile)
        self._body_index = alphabet_index(self._profile.body_alphabet_norm)

    @property
    def profile(self) -> PreparedProfile:
        return self._profile

    def capacity(self) -> int:
        return self._profile.capacity

    def _feistel_key(self) -> FeistelKey:
        perm = self._profile.permutation
        return FeistelKey(
            profile_id=self._profile.profile_id,
            key_bytes=perm.key_bytes,
            rounds=perm.rounds,
        )

    def encode(self, id: int) -> str:
        """Spec 8, including the section 18.2 blocked-substring scan."""
        if isinstance(id, bool) or not isinstance(id, int):
            raise BasehError(OUT_OF_RANGE, "id must be an integer")
        value = id
        if value < 0 or value >= self._profile.capacity:
            raise BasehError(OUT_OF_RANGE, f"ID {value} is outside the profile capacity")
        if self._profile.permutation.enabled:
            value = permute(value, self._profile.capacity, self._feistel_key())
        body = encode_base_n(
            value, self._profile.body_alphabet_norm, self._profile.body_length
        )
        checksum = calculate_checksum(self._profile, body)
        raw = body + checksum
        # Spec 18.2: case-insensitive substring scan over the raw code.
        if self._profile.blocklist:
            upper = raw.upper()
            if any(word in upper for word in self._profile.blocklist):
                raise BasehError(
                    BLOCKED_CODE,
                    "The generated reference contains a blocked substring",
                    False,
                )
        return format_raw(raw, self._profile)

    def decode(
        self,
        input: str,
        *,
        accept_spaces: bool = False,
        try_correction: bool = False,
        confusion_profile: str = "none",
        max_corrections: int = 1,
    ) -> DecodeResult:
        """Spec 9."""
        raw = normalize(input, self._profile, accept_spaces)
        body = raw[: self._profile.body_length]
        supplied_checksum = raw[self._profile.body_length :]

        # Spec 3.1 validates union membership before the split. There is no
        # per-region membership check: a checksum-region symbol outside the
        # checksum alphabet fails as INVALID_CHECKSUM and a body symbol
        # outside the body alphabet fails in the checksum or base-N work as
        # INVALID_CHARACTER.

        if calculate_checksum(self._profile, body) != supplied_checksum:
            if not try_correction or max_corrections == 0:
                raise BasehError(
                    INVALID_CHECKSUM, "The reference code did not pass validation"
                )
            if confusion_profile == "none":
                confusion_map: dict = {}
            elif confusion_profile in CONFUSION_MAPS:
                confusion_map = CONFUSION_MAPS[confusion_profile]
            else:
                raise ValueError(
                    f"unknown confusion profile: {confusion_profile!r}"
                )
            valid: set = set()
            for candidate in generate_candidates(body, confusion_map, max_corrections):
                if calculate_checksum(self._profile, candidate) == supplied_checksum:
                    valid.add(candidate)
            if not valid:
                raise BasehError(
                    INVALID_CHECKSUM, "The reference code did not pass validation"
                )
            if len(valid) > 1:
                raise BasehError(
                    AMBIGUOUS_INPUT,
                    "The reference code matches more than one record",
                    False,
                )
            body = next(iter(valid))

        value = decode_base_n(
            body, self._profile.body_alphabet_norm, self._body_index
        )
        if self._profile.permutation.enabled:
            value = inverse_permute(
                value, self._profile.capacity, self._feistel_key()
            )
        canonical_code = self.encode(value)
        if self._profile.separator:
            canonical_raw = canonical_code.replace(self._profile.separator, "")
        else:
            canonical_raw = canonical_code
        return DecodeResult(
            id=value,
            canonical_code=canonical_code,
            corrected=(raw != canonical_raw),
        )

    def validate(self, input: str, **options) -> dict:
        """Spec 12.4. Never raises on user input."""
        try:
            result = self.decode(input, **options)
            return {"valid": True, "canonical_code": result.canonical_code}
        except BasehError as err:
            return {"valid": False, "reason": err.code}
