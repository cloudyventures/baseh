"""Short checksum tests, mirroring js/test/short-checksum.test.ts (spec 22):
frozen tier shape, generation round trips and the short/normal boundary,
effective-K decode, validation errors, interactions with the repetition
filter and separator threshold, and a custom short-checksum window."""

import re
import unittest

from baseh import (
    Baseh,
    BasehError,
    INVALID_PROFILE,
    baseh_expandable_p_v1,
    baseh_expandable_v1,
    baseh_medium_v1,
    effective_checksum_length,
    generation_base,
    generation_capacity,
)
from baseh.checksum import calculate_checksum

_TEST_KEY = b"test-only-key-material-0001"


def _raw(code):
    return code.replace("-", "")


def _expect_error(fn, code):
    try:
        fn()
    except BasehError as err:
        if err.code != code:
            raise AssertionError(f"expected {code}, got {err.code}")
        return
    raise AssertionError(f"expected {code}")


def _first_issuable(codec, from_id):
    """Find the first issuable id at or after from_id."""
    for id in range(from_id, from_id + 10000):
        try:
            codec.encode(id)
            return id
        except BasehError:
            continue
    raise AssertionError(f"no issuable id from {from_id}")


class TestFrozenTierShape(unittest.TestCase):
    def setUp(self):
        self.codec = Baseh(baseh_expandable_v1())

    def test_ships_feature_on(self):
        profile = self.codec.profile
        self.assertEqual(profile.checksum_length, 2)
        self.assertEqual(profile.short_checksum_length, 1)
        self.assertEqual(profile.short_checksum_until, 5)
        keyed = Baseh(baseh_expandable_p_v1(_TEST_KEY, key_id="test-01"))
        self.assertEqual(keyed.profile.short_checksum_length, 1)
        self.assertEqual(keyed.profile.short_checksum_until, 5)

    def test_effective_checksum_length_per_generation(self):
        profile = self.codec.profile
        self.assertEqual(effective_checksum_length(profile, 4), 1)
        self.assertEqual(effective_checksum_length(profile, 5), 1)
        self.assertEqual(effective_checksum_length(profile, 6), 2)
        self.assertEqual(effective_checksum_length(profile, 8), 2)

    def test_generation_capacities_follow_effective_k(self):
        profile = self.codec.profile
        self.assertEqual(generation_capacity(profile, 4), 19683)  # 27^3
        self.assertEqual(generation_capacity(profile, 5), 531441)  # 27^4
        # one symbol buys the second checksum
        self.assertEqual(generation_capacity(profile, 6), 531441)
        self.assertEqual(generation_capacity(profile, 7), 14348907)
        self.assertEqual(generation_capacity(profile, 8), 387420489)


class TestRoundTripsAndBoundaries(unittest.TestCase):
    def setUp(self):
        self.codec = Baseh(baseh_expandable_v1())

    def test_first_and_last_issuable_of_generations_4_to_8(self):
        for length in range(4, 9):
            first = _first_issuable(
                self.codec, generation_base(self.codec.profile, length)
            )
            last = generation_base(self.codec.profile, length + 1) - 1
            for id in (first, last):
                with self.subTest(id=id):
                    try:
                        code = self.codec.encode(id)
                    except BasehError as err:
                        self.assertEqual(err.code, "BLOCKED_CODE")
                        continue
                    self.assertEqual(len(_raw(code)), length)
                    result = self.codec.decode(code)
                    self.assertEqual(result.id, id)
                    self.assertEqual(result.canonical_code, code)

    def test_short_normal_boundary(self):
        profile = self.codec.profile
        last_short = generation_base(profile, 6) - 1  # 551,123
        first_normal = generation_base(profile, 6)  # 551,124
        self.assertEqual(last_short, 551123)
        self.assertEqual(first_normal, 551124)
        a = _raw(self.codec.encode(last_short))
        self.assertEqual(len(a), 5)
        self.assertEqual(len(a) - 1, 4)  # 1 checksum symbol at length 5
        self.assertEqual(self.codec.decode(a).id, last_short)
        b = _raw(self.codec.encode(first_normal))
        self.assertEqual(len(b), 6)
        self.assertEqual(len(b) - 2, 4)  # 2 checksum symbols at length 6
        self.assertEqual(self.codec.decode(b).id, first_normal)

    def test_four_char_code_validates_against_one_checksum_symbol(self):
        profile = self.codec.profile
        id = _first_issuable(self.codec, 0)
        code = _raw(self.codec.encode(id))
        self.assertEqual(len(code), 4)
        self.assertEqual(
            code[3:], calculate_checksum(profile, code[:3], 1)
        )
        # Flipping the single checksum symbol fails.
        check = code[3]
        bad = "1" if check == "0" else "0"
        _expect_error(lambda: self.codec.decode(code[:3] + bad), "INVALID_CHECKSUM")
        # Appending a second checksum symbol changes the generation; the
        # split moves and the code fails (spec 19.7), it never validates as
        # gen 4 + 2.
        _expect_error(lambda: self.codec.decode(code + check), "INVALID_CHECKSUM")

    def test_short_generations_use_modulus_35(self):
        profile = self.codec.profile
        id = _first_issuable(self.codec, 0)
        body = _raw(self.codec.encode(id))[:3]
        short = calculate_checksum(profile, body, 1)
        full = calculate_checksum(profile, body, 2)
        self.assertEqual(len(short), 1)
        self.assertEqual(len(full), 2)
        self.assertEqual(_raw(self.codec.encode(id))[3:], short)

    def test_separator_threshold_is_total_length(self):
        # Length 5 renders bare even though its body grew; length 6 splits.
        self.assertNotIn(
            "-", self.codec.encode(generation_base(self.codec.profile, 5))
        )
        code = self.codec.encode(
            _first_issuable(self.codec, generation_base(self.codec.profile, 6))
        )
        self.assertRegex(code, r"^...-...$")

    def test_repetition_scan_covers_short_checksum(self):
        # A run of 4 that spans body and the single checksum symbol must be
        # blocked. The scan rule is profile-independent, so use a small
        # permutation-free profile where such a code is guaranteed and fast
        # to find, then confirm the filter blocks it.
        shape = {
            "profileId": "short-rep-test",
            "mode": "expandable",
            "bodyAlphabet": "AB",
            "minLength": 4,
            "checksumAlphabet": "0AB",
            "checksumLength": 2,
            "shortChecksumLength": 1,
            "shortChecksumUntil": 5,
            "caseSensitive": False,
            "separator": "",
            "separatorMinLength": 0,
            "grouping": [],
            "aliases": {},
            "permutation": {"enabled": False},
            "profanity": {"mode": "none"},
            "maxRepetition": 0,
        }
        probe = Baseh(shape)
        found = None
        for id in range(0, 2000):
            raw = _raw(probe.encode(id))
            if len(raw) >= 4 and re.search(r"(.)\1{3}$", raw):
                found = id
                break
        self.assertIsNotNone(found, "expected a code ending in a run of 4")
        blocked = Baseh({**shape, "maxRepetition": 4})
        _expect_error(lambda: blocked.encode(found), "BLOCKED_CODE")


class TestValidation(unittest.TestCase):
    def setUp(self):
        self.base = baseh_expandable_v1()

    def test_rejects_fields_in_fixed_mode(self):
        _expect_error(
            lambda: Baseh(
                {
                    **baseh_medium_v1(),
                    "shortChecksumLength": 1,
                    "shortChecksumUntil": 5,
                }
            ),
            INVALID_PROFILE,
        )
        _expect_error(
            lambda: Baseh({**baseh_medium_v1(), "shortChecksumUntil": 5}),
            INVALID_PROFILE,
        )

    def test_rejects_short_length_at_or_above_checksum_length(self):
        for short in (2, 3):
            with self.subTest(short=short):
                _expect_error(
                    lambda: Baseh(
                        {
                            **self.base,
                            "shortChecksumLength": short,
                            "shortChecksumUntil": 5,
                        }
                    ),
                    INVALID_PROFILE,
                )

    def test_rejects_until_below_min_length(self):
        _expect_error(
            lambda: Baseh(
                {**self.base, "shortChecksumLength": 1, "shortChecksumUntil": 3}
            ),
            INVALID_PROFILE,
        )

    def test_rejects_min_length_at_or_below_short_length(self):
        _expect_error(
            lambda: Baseh(
                {
                    **self.base,
                    "minLength": 1,
                    "shortChecksumLength": 1,
                    "shortChecksumUntil": 5,
                }
            ),
            INVALID_PROFILE,
        )

    def test_until_alone_is_a_legal_zero_checksum_window(self):
        # Spec 22 amendment: the window field is the switch, so until + absent
        # length (defaults to 0) is the zero-checksum window, not an error.
        codec = Baseh({**self.base, "shortChecksumLength": 0, "shortChecksumUntil": 5})
        self.assertEqual(codec.profile.short_checksum_length, 0)
        self.assertEqual(effective_checksum_length(codec.profile, 4), 0)

    def test_rejects_length_without_until(self):
        plain = {**self.base, "shortChecksumLength": 0, "shortChecksumUntil": 0}
        _expect_error(
            lambda: Baseh({**plain, "shortChecksumLength": 1}), INVALID_PROFILE
        )

    def test_rejects_until_above_8(self):
        _expect_error(
            lambda: Baseh(
                {**self.base, "shortChecksumLength": 1, "shortChecksumUntil": 9}
            ),
            INVALID_PROFILE,
        )

    def test_accepts_until_8(self):
        codec = Baseh({**self.base, "shortChecksumLength": 1, "shortChecksumUntil": 8})
        self.assertEqual(effective_checksum_length(codec.profile, 8), 1)
        self.assertEqual(effective_checksum_length(codec.profile, 9), 2)

    def test_rejects_non_integer_short_length(self):
        _expect_error(
            lambda: Baseh(
                {**self.base, "shortChecksumLength": 1.5, "shortChecksumUntil": 5}
            ),
            INVALID_PROFILE,
        )

    def test_zero_or_absent_turns_feature_off(self):
        off = Baseh(
            {**self.base, "shortChecksumLength": 0, "shortChecksumUntil": 0}
        )
        self.assertEqual(off.profile.short_checksum_length, 0)
        self.assertEqual(generation_capacity(off.profile, 4), 729)
        self.assertEqual(effective_checksum_length(off.profile, 4), 2)
        code = off.encode(100)
        self.assertEqual(len(_raw(code)), 4)
        self.assertEqual(off.decode(code).id, 100)

    def test_custom_window_round_trips_every_generation(self):
        profile = {
            **self.base,
            "profileId": "short-window-test",
            "minLength": 4,
            "checksumLength": 2,
            "shortChecksumLength": 1,
            "shortChecksumUntil": 6,
            "permutation": {"enabled": False},
            "profanity": {"mode": "none"},
            "maxRepetition": 0,
        }
        codec = Baseh(profile)
        # Body sizes: 3, 4, 5 through length 6 (K = 1), then L - 2.
        self.assertEqual(generation_capacity(codec.profile, 4), 27**3)
        self.assertEqual(generation_capacity(codec.profile, 6), 27**5)
        self.assertEqual(generation_capacity(codec.profile, 7), 27**5)  # K = 2
        self.assertGreater(
            generation_capacity(codec.profile, 6),
            generation_capacity(codec.profile, 5),
        )
        for length in range(4, 9):
            with self.subTest(length=length):
                id = generation_base(codec.profile, length) + 7
                code = codec.encode(id)
                self.assertEqual(len(_raw(code)), length)
                self.assertEqual(codec.decode(code).id, id)


class TestZeroChecksumWindow(unittest.TestCase):
    """Spec 22 amendment: a short_checksum_length of 0 inside a set window
    means no checksum symbols at those lengths — generations are all body."""

    def setUp(self):
        self.base = baseh_expandable_v1()
        self.zero_profile = {
            **self.base,
            "profileId": "short-zero-test",
            "minLength": 4,
            "checksumLength": 2,
            "shortChecksumLength": 0,
            "shortChecksumUntil": 5,
            "permutation": {"enabled": False},
            "profanity": {"mode": "none"},
            "maxRepetition": 0,
        }
        self.codec = Baseh(self.zero_profile)

    def test_effective_k_zero_inside_window(self):
        profile = self.codec.profile
        self.assertEqual(effective_checksum_length(profile, 4), 0)
        self.assertEqual(effective_checksum_length(profile, 5), 0)
        self.assertEqual(effective_checksum_length(profile, 6), 2)

    def test_window_generations_are_all_body(self):
        profile = self.codec.profile
        self.assertEqual(generation_capacity(profile, 4), 27**4)
        self.assertEqual(generation_capacity(profile, 5), 27**5)
        self.assertEqual(generation_capacity(profile, 6), 27**4)  # K = 2 above

    def test_round_trips_generations_4_to_6(self):
        profile = self.codec.profile
        for length in range(4, 7):
            for id in (
                generation_base(profile, length),
                generation_base(profile, length + 1) - 1,
            ):
                with self.subTest(length=length, id=id):
                    code = self.codec.encode(id)
                    self.assertEqual(len(_raw(code)), length)
                    result = self.codec.decode(code)
                    self.assertEqual(result.id, id)
                    self.assertEqual(result.canonical_code, code)

    def test_checksum_of_zero_symbols_is_empty_string(self):
        profile = self.codec.profile
        id = generation_base(profile, 4)
        code = _raw(self.codec.encode(id))
        self.assertEqual(len(code), 4)
        self.assertEqual(calculate_checksum(profile, code, 0), "")

    def test_typo_at_zero_checksum_generation_not_detected(self):
        # Documented trade-off (spec 22): there is no checksum to fail, so a
        # mistyped body symbol silently decodes to a different id.
        profile = self.codec.profile
        id = generation_base(profile, 4) + 1
        code = _raw(self.codec.encode(id))
        last = code[3]
        replacement = "2" if last == "1" else "1"
        typed = code[:3] + replacement
        result = self.codec.decode(typed)  # no error
        self.assertNotEqual(result.id, id)

    def test_correction_never_engages(self):
        # With no checksum there is nothing to correct against: any body
        # decodes as-is, exactly like a no-checksum fixed profile.
        profile = self.codec.profile
        id = generation_base(profile, 5) + 3
        code = _raw(self.codec.encode(id))
        result = self.codec.decode(
            code, try_correction=True, confusion_profile="heavy"
        )
        self.assertEqual(result.id, id)
        self.assertFalse(result.corrected)
        last = code[4]
        typed = code[:4] + ("2" if last == "1" else "1")
        result2 = self.codec.decode(
            typed, try_correction=True, confusion_profile="heavy"
        )
        self.assertNotEqual(result2.id, id)
        self.assertFalse(result2.corrected)

    def test_repetition_scan_covers_all_body_code(self):
        # Spec 22.4: at a zero-checksum generation the raw code is all body,
        # so the repetition scan covers the body only.
        filtered = Baseh({**self.zero_profile, "maxRepetition": 4})
        found = None
        for id in range(0, generation_capacity(self.codec.profile, 4)):
            if re.search(r"(.)\1{3}", _raw(self.codec.encode(id))):
                found = id
                break
        self.assertIsNotNone(found, "expected a gen-4 code with a run of 4")
        _expect_error(lambda: filtered.encode(found), "BLOCKED_CODE")


class TestUntil8WindowBoundary(unittest.TestCase):
    def setUp(self):
        self.codec = Baseh(
            {
                **baseh_expandable_v1(),
                "profileId": "short-until-8-test",
                "minLength": 4,
                "checksumLength": 2,
                "shortChecksumLength": 1,
                "shortChecksumUntil": 8,
                "permutation": {"enabled": False},
                "profanity": {"mode": "none"},
                "maxRepetition": 0,
            }
        )

    def test_generation_8_short_generation_9_full(self):
        profile = self.codec.profile
        id8 = generation_base(profile, 8) + 5
        c8 = _raw(self.codec.encode(id8))
        self.assertEqual(len(c8), 8)
        self.assertEqual(c8[7:], calculate_checksum(profile, c8[:7], 1))
        self.assertEqual(self.codec.decode(c8).id, id8)
        id9 = generation_base(profile, 9) + 5
        c9 = _raw(self.codec.encode(id9))
        self.assertEqual(len(c9), 9)
        self.assertEqual(c9[7:], calculate_checksum(profile, c9[:7], 2))
        self.assertEqual(self.codec.decode(c9).id, id9)


if __name__ == "__main__":
    unittest.main()
