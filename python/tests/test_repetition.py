"""Repetition filter tests, spec section 21. Mirrors js/test/repetition.test.ts."""

import unittest

from baseh import (
    BLOCKED_CODE,
    INVALID_PROFILE,
    Baseh,
    BasehError,
    baseh_expandable_p_v1,
    baseh_expandable_v1,
    baseh_heavy_p_v1,
    baseh_heavy_v1,
    baseh_light_p_v1,
    baseh_light_v1,
    baseh_medium_p_v1,
    baseh_medium_v1,
    baseh_minimum_p_v1,
    baseh_minimum_v1,
)
from baseh.checksum import calculate_checksum
from baseh.profile import prepare_profile

_TEST_KEY = b"test-only-key-material-0001"
_ALPHA32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _alpha32(**overrides) -> dict:
    profile = {
        "profileId": "rep-test",
        "bodyAlphabet": _ALPHA32,
        "bodyLength": 6,
        "checksumAlphabet": "234679ACDEFGHJKMNPQRTUVWXY",
        "checksumLength": 1,
        "caseSensitive": False,
        "separator": "",
        "grouping": [],
        "aliases": {"O": "0", "I": "1", "L": "1"},
        "permutation": {"enabled": False},
    }
    profile.update(overrides)
    return profile


def _max_run(raw: str) -> int:
    best = 1
    run = 1
    for i in range(1, len(raw)):
        run = run + 1 if raw[i] == raw[i - 1] else 1
        best = max(best, run)
    return best


def _find_id_with_run(profile: dict, n: int, limit: int = 5_000_000) -> int:
    """First id whose raw code (per a filter-free twin) has max run exactly n."""
    twin = Baseh({**profile, "maxRepetition": 0, "profanity": {"mode": "none"}})
    for id in range(limit):
        raw = twin.encode(id).replace("-", "")
        if _max_run(raw) == n:
            return id
    raise AssertionError(f"no id with max run {n} below {limit}")


def _assert_blocked(self, fn):
    with self.assertRaises(BasehError) as ctx:
        fn()
    self.assertEqual(ctx.exception.code, BLOCKED_CODE)


class TestRepetitionValidation(unittest.TestCase):
    def test_rejects_1_and_2_accepts_0_and_3(self):
        for bad in (1, 2):
            with self.assertRaises(BasehError) as ctx:
                prepare_profile(_alpha32(maxRepetition=bad))
            self.assertEqual(ctx.exception.code, INVALID_PROFILE)
        self.assertEqual(prepare_profile(_alpha32(maxRepetition=0)).max_repetition, 0)
        self.assertEqual(prepare_profile(_alpha32(maxRepetition=3)).max_repetition, 3)
        # A value above the code length is a legal no-op.
        self.assertEqual(prepare_profile(_alpha32(maxRepetition=99)).max_repetition, 99)

    def test_defaults_to_0_off(self):
        self.assertEqual(prepare_profile(_alpha32()).max_repetition, 0)


class TestRepetitionEncode(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profile = _alpha32(maxRepetition=4)
        cls.codec = Baseh(cls.profile)

    def test_blocks_a_run_of_exactly_4(self):
        _assert_blocked(self, lambda: self.codec.encode(_find_id_with_run(self.profile, 4)))

    def test_allows_a_run_of_exactly_3_boundary(self):
        id = _find_id_with_run(self.profile, 3)
        self.assertEqual(self.codec.decode(self.codec.encode(id)).id, id)

    def test_is_off_at_0(self):
        off = Baseh(_alpha32(maxRepetition=0))
        id = _find_id_with_run(self.profile, 4)
        self.assertEqual(off.decode(off.encode(id)).id, id)

    def test_custom_max_repetition_3_blocks_triples(self):
        three = _alpha32(maxRepetition=3)
        _assert_blocked(
            self, lambda: Baseh(three).encode(_find_id_with_run(three, 3))
        )

    def test_separators_do_not_break_a_run(self):
        # body "AAAA" renders AA-AA-...: no formatted group shows a run of 4,
        # but the raw code is AAAA + checksum, a run of 4, so the filter fires.
        sep = {
            "profileId": "rep-sep-test",
            "bodyAlphabet": "0123456789ABCDEF",
            "bodyLength": 4,
            "checksumAlphabet": "234679ACDEFGHJKMNPQRTUVWXY",
            "checksumLength": 1,
            "caseSensitive": False,
            "separator": "-",
            "grouping": [2, 2, 1],
            "aliases": {},
            "permutation": {"enabled": False},
            "maxRepetition": 4,
        }
        id = 10 * 16**3 + 10 * 16**2 + 10 * 16 + 10  # body AAAA
        twin = Baseh({**sep, "maxRepetition": 0})
        self.assertTrue(twin.encode(id).startswith("AA-AA"))
        _assert_blocked(self, lambda: Baseh(sep).encode(id))

    def test_issuance_skips_a_blocked_id_by_advancing(self):
        id = _find_id_with_run(self.profile, 4)
        code = None
        while code is None:
            try:
                code = self.codec.encode(id)
            except BasehError as err:
                self.assertEqual(err.code, BLOCKED_CODE)
                id += 1
        self.assertEqual(self.codec.decode(code).id, id)


class TestRepetitionDecode(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profile = _alpha32(maxRepetition=4)
        cls.codec = Baseh(cls.profile)
        cls.twin = Baseh(_alpha32(maxRepetition=0))

    def test_decode_reports_blocked_code_for_an_unissuable_code(self):
        code = self.twin.encode(_find_id_with_run(self.profile, 4))
        _assert_blocked(self, lambda: self.codec.decode(code))

    def test_correction_never_corrects_into_a_blocked_code(self):
        # "00BBBB" is one light-confusion flip (D->B) from the presented body
        # "00DBBB"; the sole checksum-matching candidate carries a run of 4,
        # so decode surfaces BLOCKED_CODE instead of returning the corrected
        # code.
        prepared = prepare_profile(_alpha32())
        check = calculate_checksum(prepared, "00BBBB")
        _assert_blocked(
            self,
            lambda: self.codec.decode(
                "00DBBB" + check, try_correction=True, confusion_profile="light"
            ),
        )


class TestFrozenTiersShipMaxRepetition4(unittest.TestCase):
    def test_every_frozen_tier_blocks_a_doctored_4_run_id(self):
        tiers = [
            ("baseh-minimum-v1", baseh_minimum_v1),
            ("baseh-light-v1", baseh_light_v1),
            ("baseh-medium-v1", baseh_medium_v1),
            ("baseh-heavy-v1", baseh_heavy_v1),
            ("baseh-minimum-p-v1", lambda: baseh_minimum_p_v1(_TEST_KEY)),
            ("baseh-light-p-v1", lambda: baseh_light_p_v1(_TEST_KEY)),
            ("baseh-medium-p-v1", lambda: baseh_medium_p_v1(_TEST_KEY)),
            ("baseh-heavy-p-v1", lambda: baseh_heavy_p_v1(_TEST_KEY)),
            ("baseh-expandable-v1", baseh_expandable_v1),
            ("baseh-expandable-p-v1", lambda: baseh_expandable_p_v1(_TEST_KEY)),
        ]
        for name, build in tiers:
            with self.subTest(profile=name):
                profile = build()
                self.assertEqual(prepare_profile(profile).max_repetition, 4)
                codec = Baseh(profile)
                id = _find_id_with_run(profile, 4)
                _assert_blocked(self, lambda: codec.encode(id))


if __name__ == "__main__":
    unittest.main()
