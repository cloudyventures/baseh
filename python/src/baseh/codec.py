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
    INVALID_PROFILE,
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
    had_separator = bool(profile.separator) and profile.separator in s
    if profile.separator:
        s = s.replace(profile.separator, "")
    if accept_spaces:
        s = s.replace(" ", "")
    if not profile.case_sensitive:
        s = s.upper()
    allowed = set(profile.body_alphabet_norm) | set(profile.checksum_alphabet_norm)
    # Spec 3.2: an alias never maps two distinct canonical symbols into one
    # value, so a symbol that is already canonical stays as-is and only
    # non-canonical symbols are aliased. (In fixed tiers alias sources are
    # never canonical, so this changes nothing there.)
    if profile.aliases_norm:
        s = "".join(ch if ch in allowed else profile.aliases_norm.get(ch, ch) for ch in s)
    for ch in s:
        if ch not in allowed:
            raise BasehError(INVALID_CHARACTER, f"Symbol {ch!r} is not accepted")
    if profile.mode == "expandable":
        # Spec 19.2/19.7: no left-padding and no stripped-zero leniency.
        # Input shorter than minLength or longer than 32 fails
        # INVALID_LENGTH, and a separator below separatorMinLength is
        # rejected (spec 19.5: the decoder expects no separators there).
        if len(s) < profile.min_length:
            raise BasehError(
                INVALID_LENGTH,
                f"Expected at least {profile.min_length} symbols, got {len(s)}",
            )
        if len(s) > 32:
            raise BasehError(
                INVALID_LENGTH, f"Expected at most 32 symbols, got {len(s)}"
            )
        if had_separator and len(s) < profile.separator_min_length:
            raise BasehError(
                INVALID_CHARACTER,
                f"Separators do not appear below {profile.separator_min_length} symbols",
            )
        return s
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


def _format_with(raw: str, sizes, separator: str) -> str:
    if not separator:
        return raw
    parts = []
    offset = 0
    for size in sizes:
        parts.append(raw[offset : offset + size])
        offset += size
    return separator.join(parts)


def format_raw(raw: str, profile: PreparedProfile) -> str:
    if profile.mode == "expandable":
        if not profile.separator or len(raw) < profile.separator_min_length:
            return raw
        return _format_with(raw, expandable_grouping(len(raw)), profile.separator)
    return _format_with(raw, profile.grouping, profile.separator)


def expandable_grouping(length: int) -> list:
    """Spec 19.5. Balanced grouping: the split is a pure function of the
    total length — g = max(2, ceil(L / 5)) groups differing in size by at
    most one, larger groups to the left. There is no configurable pattern
    in expandable mode (grouping must be empty, section 2.2)."""
    g = max(2, -(-length // 5))
    base = length // g
    if base < 1:
        return [length]
    rem = length % g
    return [base + 1] * rem + [base] * (g - rem)


def generation_base(profile: PreparedProfile, length: int) -> int:
    """Spec 19.1. First id of generation L: the sum of A^(k-K) for k from
    minLength through L-1."""
    a = len(profile.body_alphabet_norm)
    base = 0
    cap = a ** (profile.min_length - profile.checksum_length)
    for _ in range(profile.min_length, length):
        base += cap
        cap *= a
    return base


def generation_capacity(profile: PreparedProfile, length: int) -> int:
    """Spec 19.1. Ids held by generation L: A^(L-K)."""
    return len(profile.body_alphabet_norm) ** (length - profile.checksum_length)


def generation_for_id(profile: PreparedProfile, id: int) -> int:
    """Smallest generation whose range holds id, per spec 19.6."""
    length = profile.min_length
    base = 0
    cap = generation_capacity(profile, length)
    while id >= base + cap:
        base += cap
        cap *= len(profile.body_alphabet_norm)
        length += 1
    return length


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
        # Spec 12.3: fixed mode only. Expandable profiles have no single
        # capacity; use the per-generation formulas of spec 19.1.
        if self._profile.mode != "fixed":
            raise BasehError(
                INVALID_PROFILE,
                "capacity() is only defined for fixed-mode profiles",
                False,
            )
        return self._profile.capacity

    def _feistel_key(self, length: int | None = None) -> FeistelKey:
        perm = self._profile.permutation
        return FeistelKey(
            profile_id=self._profile.profile_id,
            key_bytes=perm.key_bytes,
            rounds=perm.rounds,
            length=length,
        )

    def _check_blocked(self, raw: str) -> None:
        # Spec 18.2: case-insensitive substring scan over the raw code.
        if self._profile.blocklist:
            upper = raw.upper()
            if any(word in upper for word in self._profile.blocklist):
                raise BasehError(
                    BLOCKED_CODE,
                    "The generated reference contains a blocked substring",
                    False,
                )
        # Spec 21.2: a run of the same symbol at or above maxRepetition
        # blocks the code. Runs are measured on the raw string, so a
        # separator never breaks a run.
        max_repetition = self._profile.max_repetition
        if max_repetition > 0:
            run = 1
            for i in range(1, len(raw)):
                run = run + 1 if raw[i] == raw[i - 1] else 1
                if run >= max_repetition:
                    raise BasehError(
                        BLOCKED_CODE,
                        "The generated reference repeats a symbol beyond the profile limit",
                        False,
                    )

    def _encode_fixed(self, id: int) -> str:
        """Spec 8."""
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
        self._check_blocked(raw)
        return format_raw(raw, self._profile)

    def _encode_expandable(self, id: int) -> str:
        """Spec 19.6."""
        if id < 0:
            raise BasehError(OUT_OF_RANGE, f"ID {id} is negative")
        length = generation_for_id(self._profile, id)
        if length > 32:
            raise BasehError(
                OUT_OF_RANGE, f"ID {id} requires a code longer than 32 symbols"
            )
        value = id - generation_base(self._profile, length)
        domain = generation_capacity(self._profile, length)
        if self._profile.permutation.enabled:
            value = permute(value, domain, self._feistel_key(length))
        body = encode_base_n(
            value,
            self._profile.body_alphabet_norm,
            length - self._profile.checksum_length,
        )
        checksum = calculate_checksum(self._profile, body)
        raw = body + checksum
        self._check_blocked(raw)
        return format_raw(raw, self._profile)

    def encode(self, id: int) -> str:
        """Spec 8/19.6, including the 18.2 blocklist and 21.2 repetition scans."""
        if isinstance(id, bool) or not isinstance(id, int):
            raise BasehError(OUT_OF_RANGE, "id must be an integer")
        if self._profile.mode == "expandable":
            return self._encode_expandable(id)
        return self._encode_fixed(id)

    def decode(
        self,
        input: str,
        *,
        accept_spaces: bool = False,
        try_correction: bool = False,
        confusion_profile: str = "none",
        max_corrections: int = 1,
    ) -> DecodeResult:
        """Spec 9/19.7."""
        raw = normalize(input, self._profile, accept_spaces)
        body_length = (
            len(raw) - self._profile.checksum_length
            if self._profile.mode == "expandable"
            else self._profile.body_length
        )
        body = raw[:body_length]
        supplied_checksum = raw[body_length:]

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
                raw_map: dict = {}
            elif confusion_profile in CONFUSION_MAPS:
                raw_map = CONFUSION_MAPS[confusion_profile]
            else:
                raise ValueError(
                    f"unknown confusion profile: {confusion_profile!r}"
                )
            # Spec 10: replacements that are not body alphabet symbols are
            # dropped before candidate generation. A suggested symbol the
            # alphabet cannot contain (say a spoken drop on a stripped-alphabet
            # profile) could never validate; generating it anyway would raise
            # INVALID_CHARACTER from the checksum step instead of reporting an
            # honest INVALID_CHECKSUM.
            body_set = set(self._profile.body_alphabet_norm)
            confusion_map = {}
            for source, replacements in raw_map.items():
                kept = [r for r in replacements if r in body_set]
                if kept:
                    confusion_map[source] = kept
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
        if self._profile.mode == "expandable":
            # Spec 19.7: the offset is de-permuted within the generation's own
            # domain, then the generation base is added back.
            length = len(raw)
            if self._profile.permutation.enabled:
                value = inverse_permute(
                    value,
                    generation_capacity(self._profile, length),
                    self._feistel_key(length),
                )
            value = generation_base(self._profile, length) + value
        elif self._profile.permutation.enabled:
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
