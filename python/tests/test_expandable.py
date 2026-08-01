"""Expandable mode tests, mirroring js/test/expandable.test.ts:
frozen tier shape, boundary round trips, zero ban, checksum zero handling,
no left padding, separator threshold shapes, wrong-generation rejection,
keyed -p tier and mixed-mode interop."""

import unittest

from baseh import (
    Baseh,
    BasehError,
    INVALID_CHARACTER,
    INVALID_CHECKSUM,
    INVALID_LENGTH,
    INVALID_PROFILE,
    OUT_OF_RANGE,
    baseh_expandable_p_v1,
    baseh_expandable_v1,
    baseh_medium_v1,
    effective_checksum_length,
    expandable_grouping,
    generation_base,
    generation_capacity,
    generation_for_id,
)
from baseh.basen import alphabet_index
from baseh.checksum import checksum_value
from baseh.profile import prepare_profile

_TEST_KEY = b"test-only-key-material-0001"


def _custom_expandable(**overrides):
    """A custom expandable profile with no permutation and no blocklist."""
    profile = {
        "profileId": "custom-expandable-test",
        "mode": "expandable",
        # 0/O stripped at preparation
        "bodyAlphabet": "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        "minLength": 3,
        "checksumAlphabet": "",
        "checksumLength": 1,
        "caseSensitive": False,
        "separator": "",
        "separatorMinLength": 0,
        "grouping": [],
        "aliases": {"O": "0", "I": "1", "L": "1"},
        "permutation": {"enabled": False},
    }
    profile.update(overrides)
    return profile


def _raw(code):
    return code.replace("-", "")


class TestFrozenTierShape(unittest.TestCase):
    def setUp(self):
        self.codec = Baseh(baseh_expandable_v1())

    def test_derived_alphabets(self):
        profile = self.codec.profile
        self.assertEqual(
            profile.body_alphabet_norm, "123456789ACDEFGHJKMPQRUVXYZ"
        )
        self.assertEqual(len(profile.body_alphabet_norm), 27)
        self.assertEqual(
            profile.checksum_alphabet_norm, "0123456789ACDEFGHJKMPQRUVXYZ"
        )
        self.assertEqual(len(profile.checksum_alphabet_norm), 28)
        self.assertEqual(profile.checksum_modulus, 784)
        self.assertEqual(profile.mode, "expandable")
        self.assertEqual(profile.min_length, 4)
        self.assertEqual(profile.separator_min_length, 6)

    def test_generation_table(self):
        # Short checksum on (spec 22): one checksum symbol through length 5,
        # two from 6 up, so generations 5 and 6 have equal capacity.
        expected = [
            (4, "0", "19683"),
            (5, "19683", "531441"),
            (6, "551124", "531441"),
            (7, "1082565", "14348907"),
            (8, "15431472", "387420489"),
        ]
        for length, base, cap in expected:
            with self.subTest(length=length):
                self.assertEqual(
                    str(generation_base(self.codec.profile, length)), base
                )
                self.assertEqual(
                    str(generation_capacity(self.codec.profile, length)), cap
                )

    def test_capacity_is_fixed_mode_only(self):
        with self.assertRaises(BasehError) as ctx:
            self.codec.capacity()
        self.assertEqual(ctx.exception.code, INVALID_PROFILE)


class TestBoundaryRoundTrips(unittest.TestCase):
    def setUp(self):
        self.codec = Baseh(baseh_expandable_v1())

    def test_generation_boundaries_round_trip(self):
        for length in range(4, 9):
            base = generation_base(self.codec.profile, length)
            next_base = generation_base(self.codec.profile, length + 1)
            for id in (base, next_base - 1, next_base):
                with self.subTest(id=id):
                    code = self.codec.encode(id)
                    self.assertEqual(
                        len(_raw(code)), generation_for_id(self.codec.profile, id)
                    )
                    result = self.codec.decode(code)
                    self.assertEqual(result.id, id)
                    self.assertEqual(result.canonical_code, code)
                    self.assertFalse(result.corrected)
                    # The zero ban makes a non-zero leading body symbol
                    # structural.
                    self.assertNotEqual(_raw(code)[0], "0")
                    self.assertNotEqual(_raw(code)[0], "O")

    def test_last_four_char_and_first_five_char(self):
        self.assertEqual(len(_raw(self.codec.encode(19682))), 4)
        self.assertEqual(len(_raw(self.codec.encode(19683))), 5)

    def test_exhaustive_generation_four(self):
        issued = 0
        for id in range(19683):
            try:
                code = self.codec.encode(id)
            except BasehError as err:
                # Blocklisted ids are reserved, never issued (spec 18).
                self.assertEqual(err.code, "BLOCKED_CODE")
                continue
            self.assertEqual(len(_raw(code)), 4)
            self.assertEqual(self.codec.decode(code).id, id)
            issued += 1
        self.assertGreater(issued, 19000)

    def test_custom_profile_boundaries(self):
        codec = Baseh(_custom_expandable())
        # minLength 3, checksum 1, body 34: generation 3 holds 34^2 = 1156 ids.
        self.assertEqual(generation_base(codec.profile, 3), 0)
        self.assertEqual(generation_base(codec.profile, 4), 1156)
        for id in (0, 1, 1155, 1156, 40459, 40460):
            with self.subTest(id=id):
                self.assertEqual(codec.decode(codec.encode(id)).id, id)
        self.assertEqual(len(codec.encode(1155)), 3)
        self.assertEqual(len(codec.encode(1156)), 4)


class TestZeroBan(unittest.TestCase):
    def setUp(self):
        self.codec = Baseh(baseh_expandable_v1())

    def test_zero_in_body_position_rejected(self):
        code = _raw(self.codec.encode(1000))
        with self.assertRaises(BasehError) as ctx:
            self.codec.decode("0" + code[1:])
        self.assertEqual(ctx.exception.code, INVALID_CHARACTER)

    def test_typed_o_in_body_position_rejected_after_alias(self):
        code = _raw(self.codec.encode(1000))
        with self.assertRaises(BasehError) as ctx:
            self.codec.decode("O" + code[1:])
        self.assertEqual(ctx.exception.code, INVALID_CHARACTER)

    def test_custom_alphabet_zero_ban_strip(self):
        profile = prepare_profile(_custom_expandable())
        self.assertNotIn("0", profile.body_alphabet_norm)
        self.assertNotIn("O", profile.body_alphabet_norm)
        self.assertEqual(
            profile.body_alphabet_norm, "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ"
        )

    def test_alphabet_stripped_below_two_symbols(self):
        with self.assertRaises(BasehError) as ctx:
            Baseh(_custom_expandable(bodyAlphabet="0O"))
        self.assertEqual(ctx.exception.code, INVALID_PROFILE)


class TestChecksumWithZero(unittest.TestCase):
    def setUp(self):
        self.codec = Baseh(baseh_expandable_v1())

    def _encodable(self, id):
        try:
            return self.codec.encode(id)
        except BasehError:
            return None

    def test_checksum_containing_zero_round_trips(self):
        found = []
        id = 0
        while id < 200000 and len(found) < 8:
            code = self._encodable(id)
            if code is not None and "0" in _raw(code)[-2:]:
                found.append((id, code))
            id += 1
        self.assertGreaterEqual(len(found), 8)
        for id, code in found:
            with self.subTest(id=id):
                result = self.codec.decode(code)
                self.assertEqual(result.id, id)
                self.assertEqual(result.canonical_code, code)

    def test_typed_o_in_checksum_position_aliases_to_zero(self):
        # Spec 20.3 says "corrected true", but spec 9 defines corrected as
        # canonicalize(input) != canonicalize(canonical), and canonicalize
        # applies aliases — so an aliased input is NOT a correction. The
        # fixed-mode tests pin the same behaviour; the codec spec wins.
        pinned = None
        for id in range(500000):
            code = self._encodable(id)
            if code is not None and _raw(code).endswith("0"):
                pinned = (id, code)
                break
        self.assertIsNotNone(pinned, "expected a code whose checksum ends in 0")
        id, code = pinned
        typed = _raw(code)[:-1] + "O"
        result = self.codec.decode(typed)
        self.assertEqual(result.id, id)
        self.assertEqual(result.canonical_code, code)
        self.assertFalse(result.corrected)

    def test_substitution_and_transposition_detection(self):
        # M = 784 > 26 and gcd(36, 784) = 4, so a transposition escapes only
        # when 196 divides (a-b), impossible for |a-b| <= 26: detection is
        # provably total at the full two-symbol checksum (spec 17.1). The
        # short-checksum generations (<= 5, spec 22) run modulus 28 and are
        # excluded; the sweep pins total detection at generations 6 and 8.
        profile = self.codec.profile
        index = alphabet_index(profile.body_alphabet_norm)
        alphabet = profile.body_alphabet_norm
        for length in (6, 8):
            base = generation_base(profile, length)
            effective_k = effective_checksum_length(profile, length)
            self.assertEqual(effective_k, 2)
            body_len = length - effective_k
            misses = 0
            for id in range(base, base + 50):
                code = self._encodable(id)
                if code is None:
                    continue
                body = _raw(code)[:body_len]
                before = checksum_value(profile, body, index, effective_k)
                for pos in range(body_len):
                    cur = index[body[pos]]
                    for delta in (1, 5, 17):
                        candidate = (
                            body[:pos]
                            + alphabet[(cur + delta) % 27]
                            + body[pos + 1 :]
                        )
                        if checksum_value(profile, candidate, index, effective_k) == before:
                            misses += 1
                for pos in range(body_len - 1):
                    if body[pos] == body[pos + 1]:
                        continue
                    swapped = (
                        body[:pos] + body[pos + 1] + body[pos] + body[pos + 2 :]
                    )
                    if checksum_value(profile, swapped, index, effective_k) == before:
                        misses += 1
            self.assertEqual(misses, 0, f"generation {length} had {misses} misses")


class TestNoLeftPadding(unittest.TestCase):
    def setUp(self):
        self.codec = Baseh(baseh_expandable_v1())

    def test_short_input_rejected(self):
        for input in ("1", "ABC", ""):
            with self.subTest(input=input):
                with self.assertRaises(BasehError) as ctx:
                    self.codec.decode(input)
                self.assertEqual(ctx.exception.code, INVALID_LENGTH)

    def test_long_input_rejected(self):
        with self.assertRaises(BasehError) as ctx:
            self.codec.decode("A" * 33)
        self.assertEqual(ctx.exception.code, INVALID_LENGTH)

    def test_canonical_code_keeps_presented_length(self):
        for id in (0, 1155, 1156, 40460, 123456789):
            with self.subTest(id=id):
                code = self.codec.encode(id)
                result = self.codec.decode(code)
                self.assertEqual(
                    len(_raw(result.canonical_code)), len(_raw(code))
                )


class TestSeparatorThreshold(unittest.TestCase):
    def setUp(self):
        self.codec = Baseh(baseh_expandable_v1())

    def test_lengths_four_and_five_render_bare(self):
        self.assertNotIn("-", self.codec.encode(0))
        self.assertNotIn("-", self.codec.encode(1156))

    def test_separator_below_threshold_rejected(self):
        code = self.codec.encode(0)
        with_hyphen = code[:2] + "-" + code[2:]
        with self.assertRaises(BasehError) as ctx:
            self.codec.decode(with_hyphen)
        self.assertEqual(ctx.exception.code, INVALID_CHARACTER)

    def test_pinned_shapes(self):
        shapes = {
            6: (3, 3),
            7: (4, 3),
            8: (4, 4),
            9: (5, 4),
            10: (5, 5),
        }
        for length, groups in shapes.items():
            with self.subTest(length=length):
                id = generation_base(self.codec.profile, length)
                code = None
                for probe in range(id, id + 5000):
                    try:
                        code = self.codec.encode(probe)
                        break
                    except BasehError:
                        continue
                self.assertIsNotNone(code)
                self.assertEqual(
                    tuple(len(part) for part in code.split("-")), groups
                )
                self.assertEqual(self.codec.decode(code).canonical_code, code)

    def test_expandable_grouping_balanced(self):
        # Spec 19.5 pinned table: balanced sizes, larger groups on the left.
        pinned = {
            4: [2, 2],
            5: [3, 2],
            6: [3, 3],
            7: [4, 3],
            8: [4, 4],
            9: [5, 4],
            10: [5, 5],
            11: [4, 4, 3],
            12: [4, 4, 4],
            13: [5, 4, 4],
            14: [5, 5, 4],
            15: [5, 5, 5],
            16: [4, 4, 4, 4],
        }
        for length, sizes in pinned.items():
            with self.subTest(length=length):
                self.assertEqual(expandable_grouping(length), sizes)


class TestWrongGenerationRejection(unittest.TestCase):
    def setUp(self):
        self.codec = Baseh(baseh_expandable_v1())

    def test_appended_symbol_never_aliases_shorter_id(self):
        code = _raw(self.codec.encode(777))
        self.assertEqual(len(code), 4)
        for extra in ("1", "A", "Z"):
            with self.subTest(extra=extra):
                longer = code + extra
                result = self.codec.validate(longer)
                self.assertFalse(result["valid"])
                self.assertIn(
                    result["reason"], (INVALID_CHECKSUM, INVALID_CHARACTER)
                )
                with self.assertRaises(BasehError) as ctx:
                    self.codec.decode(longer)
                self.assertEqual(ctx.exception.code, result["reason"])

    def test_removed_symbol_fails(self):
        code = _raw(self.codec.encode(40460))  # generation 5
        result = self.codec.validate(code[1:])
        self.assertFalse(result["valid"])

    def test_correction_never_crosses_generations(self):
        # With medium safety the spoken-confusable twins T, N, W are alias
        # sources (they alias to P, M, V), so a typed twin decodes back at
        # the same length rather than via a cross-length candidate. Find a
        # generation-8 code that carries P, M or V so a typo is constructible.
        pairs = {"P": "T", "M": "N", "V": "W"}
        found = None
        id = 123456789
        while found is None:
            try:
                code = self.codec.encode(id)
            except BasehError:
                id += 1
                continue
            raw = _raw(code)
            for pos in range(len(raw) - 2):
                ch = raw[pos]
                if ch in pairs:
                    found = (id, code, raw[:pos] + pairs[ch] + raw[pos + 1:])
                    break
            if found is None:
                id += 1
        self.assertIsNotNone(found, "expected a code with a P/M/V body symbol")
        found_id, code, typo = found
        result = self.codec.decode(
            typo,
            try_correction=True,
            confusion_profile="medium",
            max_corrections=1,
        )
        self.assertEqual(len(_raw(result.canonical_code)), len(_raw(code)))
        self.assertEqual(result.id, found_id)


class TestKeyedTier(unittest.TestCase):
    def test_round_trips_with_caller_key(self):
        codec = Baseh(baseh_expandable_p_v1(_TEST_KEY, key_id="test-01"))
        self.assertEqual(codec.profile.profile_id, "baseh-expandable-p-v1")
        ids = [0, 1, 1155, 1156, 40460, 123456789, generation_base(codec.profile, 9)]
        for id in ids:
            with self.subTest(id=id):
                try:
                    code = codec.encode(id)
                except BasehError as err:
                    self.assertEqual(err.code, "BLOCKED_CODE")
                    continue
                self.assertEqual(codec.decode(code).id, id)

    def test_custom_rounds(self):
        p4 = Baseh(baseh_expandable_p_v1(_TEST_KEY, key_id="test-01", rounds=4))
        p8 = Baseh(baseh_expandable_p_v1(_TEST_KEY, key_id="test-01", rounds=8))
        code4 = p4.encode(42)
        self.assertEqual(p4.decode(code4).id, 42)
        self.assertNotEqual(code4, p8.encode(42))

    def test_keyed_differs_from_frozen(self):
        frozen = Baseh(baseh_expandable_v1())
        keyed = Baseh(baseh_expandable_p_v1(_TEST_KEY, key_id="test-01"))
        self.assertNotEqual(frozen.encode(42), keyed.encode(42))


class TestMixedModeInterop(unittest.TestCase):
    def test_explicit_fixed_matches_omitted_mode(self):
        explicit = Baseh({**baseh_medium_v1(), "mode": "fixed"})
        implicit = Baseh(baseh_medium_v1())
        for id in (0, 1, 813, 123456789, 481890303):
            with self.subTest(id=id):
                try:
                    explicit_code = explicit.encode(id)
                except BasehError:
                    explicit_code = None
                try:
                    implicit_code = implicit.encode(id)
                except BasehError:
                    implicit_code = None
                self.assertEqual(explicit_code, implicit_code)
                if explicit_code is not None:
                    self.assertEqual(
                        explicit.decode(explicit_code).id,
                        implicit.decode(explicit_code).id,
                    )

    def test_short_code_on_fixed_tier_unchanged(self):
        fixed = Baseh(baseh_medium_v1())
        result = fixed.validate("ABCD")
        self.assertFalse(result["valid"])
        self.assertEqual(result["reason"], INVALID_CHECKSUM)  # re-padded, spec 3.4

    def test_expandable_rejects_fixed_tier_code(self):
        # The decoder must not guess mode from input: an expandable profile
        # rejects a fixed-tier 8-symbol code on the checksum, per spec 19.7.
        fixed = Baseh(baseh_medium_v1())
        expandable = Baseh(baseh_expandable_v1())
        result = expandable.validate(fixed.encode(123456789))
        self.assertFalse(result["valid"])

    def test_grouping_validation_by_mode(self):
        # Spec 2.2/19.5: expandable grouping must be empty; a non-empty
        # grouping fails INVALID_PROFILE.
        Baseh(baseh_expandable_v1())
        with self.assertRaises(BasehError) as ctx:
            Baseh({**baseh_expandable_v1(), "grouping": [4, 4]})
        self.assertEqual(ctx.exception.code, INVALID_PROFILE)
        with self.assertRaises(BasehError) as ctx:
            Baseh({**baseh_medium_v1(), "grouping": [3, 3]})
        self.assertEqual(ctx.exception.code, INVALID_PROFILE)
        # separatorMinLength is expandable-only
        with self.assertRaises(BasehError) as ctx:
            Baseh({**baseh_medium_v1(), "separatorMinLength": 6})
        self.assertEqual(ctx.exception.code, INVALID_PROFILE)
        # minLength must exceed checksumLength
        with self.assertRaises(BasehError) as ctx:
            Baseh(_custom_expandable(minLength=1))
        self.assertEqual(ctx.exception.code, INVALID_PROFILE)
        # JS parity: an explicit minLength of 0 is rejected, as is a non-int.
        with self.assertRaises(BasehError) as ctx:
            Baseh(_custom_expandable(minLength=0))
        self.assertEqual(ctx.exception.code, INVALID_PROFILE)
        with self.assertRaises(BasehError) as ctx:
            Baseh(_custom_expandable(minLength="4"))
        self.assertEqual(ctx.exception.code, INVALID_PROFILE)


class TestHugeIdFailsFast(unittest.TestCase):
    """generation_for_id is range-checked before its loop, so an adversarial
    bignum id cannot force an unbounded walk (and the error never embeds the
    raw id, which would trip Python's int-to-str digit limit)."""

    def setUp(self):
        self.codec = Baseh(baseh_expandable_v1())

    def test_huge_id_out_of_range(self):
        with self.assertRaises(BasehError) as ctx:
            self.codec.encode(10**100000)
        self.assertEqual(ctx.exception.code, OUT_OF_RANGE)

    def test_generation_for_id_out_of_range(self):
        with self.assertRaises(BasehError) as ctx:
            generation_for_id(self.codec.profile, generation_base(self.codec.profile, 33))
        self.assertEqual(ctx.exception.code, OUT_OF_RANGE)

    def test_largest_supported_id_still_encodes(self):
        codec = Baseh(_custom_expandable(permutation={"enabled": False}))
        id = generation_base(codec.profile, 33) - 1
        self.assertEqual(codec.decode(codec.encode(id)).id, id)


if __name__ == "__main__":
    unittest.main()
