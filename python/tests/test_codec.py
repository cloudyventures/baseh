"""Unit tests derived from the spec and the test-suite document:
profile validation rejections, profanity modes, round trips, fuzz smoke."""

import random
import string
import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from baseh import (  # noqa: E402
    AMBIGUOUS_INPUT,
    BLOCKED_CODE,
    FROZEN_KEY_BYTES,
    INVALID_CHARACTER,
    INVALID_CHECKSUM,
    INVALID_LENGTH,
    INVALID_PROFILE,
    OUT_OF_RANGE,
    TOO_MANY_CANDIDATES,
    Baseh,
    BasehError,
    generate_candidates,
    baseh_heavy_p_v1,
    baseh_heavy_v1,
    baseh_light_p_v1,
    baseh_light_v1,
    baseh_medium_p_v1,
    baseh_medium_v1,
    baseh_minimum_p_v1,
    baseh_minimum_v1,
)

_TEST_KEY = bytes.fromhex("746573742d6f6e6c792d6b65792d6d6174657269616c2d30303031")
_CAPACITY = 481_890_304  # 28 ** 6, baseh-medium

_ALL_HELPERS = (
    baseh_minimum_v1,
    baseh_light_v1,
    baseh_medium_v1,
    baseh_heavy_v1,
)
_ALL_KEYED_HELPERS = (
    baseh_minimum_p_v1,
    baseh_light_p_v1,
    baseh_medium_p_v1,
    baseh_heavy_p_v1,
)


def _base_profile() -> dict:
    # Permutation-specific tests opt in by supplying a key explicitly. The
    # blocklist is switched off so generic round-trip tests can encode
    # sequentially; TestProfanity arms it case by case.
    profile = baseh_medium_p_v1(_TEST_KEY, key_id="test-01")
    profile["profanity"] = {"mode": "none"}
    return profile


class TestProfileHelpers(unittest.TestCase):
    def test_plain_helpers_permute_with_the_frozen_key(self):
        for helper in _ALL_HELPERS:
            with self.subTest(helper=helper.__name__):
                permutation = helper()["permutation"]
                self.assertEqual(
                    permutation,
                    {
                        "enabled": True,
                        "algorithm": "feistel-v1",
                        "keyId": "frozen",
                        "keyBytes": FROZEN_KEY_BYTES,
                        "rounds": 8,
                    },
                )

    def test_frozen_tier_shapes(self):
        # No-separator was retired; minimum keeps zero checksums at [3, 3],
        # the rest carry two at [4, 4].
        self.assertEqual(baseh_minimum_v1()["checksumLength"], 0)
        self.assertEqual(baseh_minimum_v1()["grouping"], [3, 3])
        for helper in (baseh_light_v1, baseh_medium_v1, baseh_heavy_v1):
            with self.subTest(helper=helper.__name__):
                tier = helper()
                self.assertEqual(tier["checksumLength"], 2)
                self.assertEqual(tier["separator"], "-")
                self.assertEqual(tier["grouping"], [4, 4])

    def test_frozen_key_and_private_key_scramble_differently(self):
        frozen = Baseh(baseh_medium_v1())
        privy = Baseh(baseh_medium_p_v1(_TEST_KEY))
        self.assertEqual(frozen.decode(frozen.encode(123456)).id, 123456)
        self.assertNotEqual(frozen.encode(123456), privy.encode(123456))

    def test_keyed_helpers_enable_feistel_v1(self):
        permutation = baseh_medium_p_v1(_TEST_KEY)["permutation"]
        self.assertEqual(
            permutation,
            {
                "enabled": True,
                "algorithm": "feistel-v1",
                "keyId": "default",
                "keyBytes": _TEST_KEY,
                "rounds": 8,
            },
        )
        permutation = baseh_medium_p_v1(
            _TEST_KEY, key_id="test-01", rounds=10
        )["permutation"]
        self.assertEqual(permutation["keyId"], "test-01")
        self.assertEqual(permutation["rounds"], 10)
        self.assertEqual(
            baseh_medium_p_v1(_TEST_KEY)["profileId"], "baseh-medium-p-v1"
        )

    def test_helpers_are_fresh_and_mutable(self):
        first, second = baseh_medium_v1(), baseh_medium_v1()
        first["bodyLength"] = 99
        first["aliases"]["Q"] = "0"
        self.assertEqual(second["bodyLength"], 6)
        self.assertNotIn("Q", second["aliases"])

    def test_tier_capacities(self):
        self.assertEqual(Baseh(baseh_minimum_v1()).capacity(), 2_176_782_336)
        self.assertEqual(Baseh(baseh_light_v1()).capacity(), 887_503_681)
        self.assertEqual(Baseh(baseh_medium_v1()).capacity(), 481_890_304)
        self.assertEqual(Baseh(baseh_heavy_v1()).capacity(), 308_915_776)

    def test_all_helpers_accepted(self):
        for helper in _ALL_HELPERS:
            Baseh(helper())
        for helper in _ALL_KEYED_HELPERS:
            Baseh(helper(_TEST_KEY))

    def test_round_trip_plain(self):
        for helper in _ALL_HELPERS:
            profile = helper()
            codec = Baseh(profile)
            for value in (0, 7, codec.capacity() - 1):
                with self.subTest(profile_id=profile["profileId"], id=value):
                    result = codec.decode(codec.encode(value))
                    self.assertEqual(result.id, value)
                    self.assertFalse(result.corrected)

    def test_round_trip_keyed(self):
        for helper in _ALL_KEYED_HELPERS:
            profile = helper(_TEST_KEY)
            codec = Baseh(profile)
            for value in (0, 7, codec.capacity() - 1):
                with self.subTest(profile_id=profile["profileId"], id=value):
                    result = codec.decode(codec.encode(value))
                    self.assertEqual(result.id, value)
                    self.assertFalse(result.corrected)


class _ProfileCase(unittest.TestCase):
    def assertRejects(self, mutate, label):
        profile = _base_profile()
        mutate(profile)
        with self.subTest(case=label):
            try:
                Baseh(profile)
            except BasehError as err:
                self.assertEqual(err.code, INVALID_PROFILE, label)
            else:
                self.fail(f"profile accepted: {label}")


class TestProfileValidation(_ProfileCase):
    def test_rejections(self):
        # Non-ASCII symbol: build without an escape so the source stays ASCII.
        def non_ascii(p):
            p["bodyAlphabet"] = "01" + chr(0xE9)

        def separator_in_body(p):
            p["separator"] = "-"
            p["grouping"] = [3, 3, 2]
            p["bodyAlphabet"] = "0123456789ACDEFGHJKMPQRUVXY-"

        def separator_in_checksum(p):
            p["separator"] = "-"
            p["grouping"] = [3, 3, 2]
            p["checksumAlphabet"] = "234679ACDEFGHJKMPQRUVXY"[:23] + "-"

        def group_sum_mismatch(p):
            p["separator"] = "-"
            p["grouping"] = [3, 3]

        cases = [
            (lambda p: p.update(profileId=""), "empty profile id"),
            (lambda p: p.update(bodyAlphabet="A"), "body alphabet too small"),
            (lambda p: p.update(bodyAlphabet="ABCA"), "duplicate body symbols"),
            (lambda p: p.update(bodyAlphabet="aA"), "case collision"),
            (non_ascii, "non-ascii symbol"),
            (lambda p: p.update(bodyLength=0), "zero body length"),
            (lambda p: p.update(bodyLength=-1), "negative body length"),
            (lambda p: p.update(bodyLength=33), "body length above limit"),
            (lambda p: p.update(checksumLength=-1), "negative checksum length"),
            (lambda p: p.update(checksumAlphabet="2"), "checksum alphabet too small"),
            (separator_in_body, "separator in body alphabet"),
            (separator_in_checksum, "separator in checksum alphabet"),
            (lambda p: p.update(aliases={"Z": "@"}), "alias target not canonical"),
            (lambda p: p.update(aliases={"B": "X", "X": "0"}), "alias chain"),
            (lambda p: p.update(aliases={"A": "A"}), "alias cycle (source canonical)"),
            (group_sum_mismatch, "group total mismatch"),
            (lambda p: p.update(separator="", grouping=[4, 4]),
             "grouping with empty separator"),
            (lambda p: p["permutation"].pop("keyBytes"), "missing permutation key"),
            (lambda p: p["permutation"].update(rounds=5), "odd rounds"),
            (lambda p: p["permutation"].update(rounds=2), "too few rounds"),
            (lambda p: p["permutation"].update(rounds=18), "too many rounds"),
            (lambda p: p.update(profanity={"mode": "vowel-soup"}), "unknown profanity mode"),
            (lambda p: p.update(profanity={"mode": "no-vowels"}, bodyAlphabet="AE"),
             "no-vowels strips body alphabet below two"),
            (lambda p: p.update(profanity={"mode": "blocklist", "words": ["A"]}),
             "blocklist entry too short"),
            (lambda p: p.update(profanity={"mode": "blocklist", "words": ["AB1"]}),
             "blocklist entry with digit"),
        ]
        for mutate, label in cases:
            self.assertRejects(mutate, label)

    def test_zero_checksum_profile_accepted(self):
        profile = _base_profile()
        profile["checksumLength"] = 0
        profile["checksumAlphabet"] = ""
        profile["grouping"] = [3, 3]
        Baseh(profile)

    def test_separated_profile_grouping_accepted(self):
        profile = _base_profile()
        profile["separator"] = "-"
        profile["grouping"] = [3, 3, 2]
        codec = Baseh(profile)
        code = codec.encode(1)
        self.assertEqual(code[3], "-")
        self.assertEqual(codec.decode(code).id, 1)


class TestProfanity(unittest.TestCase):
    def _profile(self, profanity, **overrides):
        profile = _base_profile()
        profile["permutation"] = {"enabled": False}
        profile.update(overrides)
        profile["profanity"] = profanity
        return profile

    def test_default_tiers_use_blocklist(self):
        codec = Baseh(baseh_medium_v1())
        self.assertNotEqual(codec.profile.blocklist, ())

    def test_blocklist_default_blocks_raw_substring(self):
        codec = Baseh(self._profile({"mode": "blocklist"}))
        # Find an id whose raw code contains a default word; encode must fail.
        blocked = None
        for value in range(200000):
            try:
                codec.encode(value)
            except BasehError as err:
                self.assertEqual(err.code, BLOCKED_CODE)
                self.assertFalse(err.safe_for_customer)
                blocked = value
                break
        self.assertIsNotNone(blocked)

    def test_blocklist_replacement_and_extra(self):
        replace = Baseh(self._profile({"mode": "blocklist", "words": ["ZZZZ"]}))
        self.assertEqual(replace.profile.blocklist, ("ZZZZ",))
        extra = Baseh(self._profile({"mode": "blocklist", "extraWords": ["QQQQ"]}))
        self.assertEqual(len(extra.profile.blocklist), 13)
        self.assertIn("QQQQ", extra.profile.blocklist)

    def test_blocklist_dedup_and_case(self):
        codec = Baseh(
            self._profile({"mode": "blocklist", "words": ["zzzz", "ZZZZ", "qq"]})
        )
        self.assertEqual(codec.profile.blocklist, ("ZZZZ", "QQ"))

    def test_no_vowels_changes_alphabet_and_capacity(self):
        codec = Baseh(self._profile({"mode": "no-vowels"}))
        for vowel in "AEIOU":
            self.assertNotIn(vowel, codec.profile.body_alphabet_norm)
        # Medium drops three vowels (A, E, U) from its 28 symbols.
        self.assertEqual(codec.capacity(), 25 ** 6)
        code = codec.encode(0)
        # 6 body + hyphen + 2 checksum symbols.
        self.assertEqual(len(code), 9)
        self.assertEqual(codec.decode(code).id, 0)

    def test_no_vowels_rejects_vowel_input(self):
        codec = Baseh(self._profile({"mode": "no-vowels"}))
        with self.assertRaises(BasehError) as ctx:
            codec.decode("0000A00")
        self.assertEqual(ctx.exception.code, INVALID_CHARACTER)


class TestRoundTrip(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.codec = Baseh(_base_profile())
        # A three-checksum variant built by mutating a fresh helper profile.
        profile_s = _base_profile()
        profile_s["profileId"] = "baseh-medium-p3-test"
        profile_s["checksumLength"] = 3
        profile_s["grouping"] = [4, 2, 3]
        cls.codec_s = Baseh(profile_s)

    def test_boundary_ids(self):
        boundary = [0, 1, 27, 28, 29, _CAPACITY - 2, _CAPACITY - 1]
        for codec in (self.codec, self.codec_s):
            for value in boundary:
                with self.subTest(id=value):
                    code = codec.encode(value)
                    result = codec.decode(code)
                    self.assertEqual(result.id, value)
                    self.assertEqual(result.canonical_code, code)
                    self.assertFalse(result.corrected)

    def test_out_of_range(self):
        for bad in (-1, _CAPACITY, _CAPACITY * 2):
            with self.subTest(id=bad):
                with self.assertRaises(BasehError) as ctx:
                    self.codec.encode(bad)
                self.assertEqual(ctx.exception.code, OUT_OF_RANGE)

    def test_capacity(self):
        self.assertEqual(self.codec.capacity(), _CAPACITY)
        self.assertEqual(self.codec_s.capacity(), _CAPACITY)

    def test_sequential_round_trip(self):
        codec = self.codec
        for value in range(10000):
            code = codec.encode(value)
            result = codec.decode(code)
            self.assertEqual(result.id, value)
            self.assertEqual(result.canonical_code, code)

    def test_raw_length(self):
        # 6 body + 2 checksum symbols with one hyphen: XXXX-XXXX.
        code = self.codec.encode(0)
        self.assertEqual(len(code), 9)
        # 6 body + 3 checksum symbols with two hyphens.
        code_s = self.codec_s.encode(0)
        self.assertEqual(len(code_s), 11)

    def test_aliases(self):
        value = None
        canonical = ""
        for candidate in range(5000):
            code = self.codec.encode(candidate)
            if "0" in code:
                value, canonical = candidate, code
                break
        self.assertIsNotNone(value)
        alias_input = canonical.replace("0", "O")
        result = self.codec.decode(alias_input)
        self.assertEqual(result.id, value)
        # Aliases are canonicalized during normalization, so the corrected
        # flag stays false; only confusion-map correction sets it.
        self.assertFalse(result.corrected)
        self.assertEqual(result.canonical_code, canonical)

    def test_validate_never_raises(self):
        self.assertEqual(
            self.codec.validate("00000000"),
            {"valid": False, "reason": INVALID_CHECKSUM},
        )
        ok = self.codec.validate(self.codec.encode(7))
        self.assertTrue(ok["valid"])
        self.assertEqual(ok["canonical_code"], self.codec.encode(7))

    def test_length_and_character_errors(self):
        # Spec 3.4: short input is re-padded, so "00000" now fails on
        # checksum instead of length. Over-long input still fails on length.
        with self.assertRaises(BasehError) as ctx:
            self.codec.decode("00000")
        self.assertEqual(ctx.exception.code, INVALID_CHECKSUM)
        with self.assertRaises(BasehError) as ctx:
            self.codec.decode("000000000")
        self.assertEqual(ctx.exception.code, INVALID_LENGTH)
        with self.assertRaises(BasehError) as ctx:
            self.codec.decode("0000@0X")
        self.assertEqual(ctx.exception.code, INVALID_CHARACTER)

    def test_candidate_cap(self):
        # A confusion map wider than the built-ins that exceeds 64 candidates.
        wide = {"0": list("123456789ABCDEFG")}
        with self.assertRaises(BasehError) as ctx:
            generate_candidates("000000", wide)
        self.assertEqual(ctx.exception.code, TOO_MANY_CANDIDATES)


class TestLookAlikeAliases(unittest.TestCase):
    """Frozen medium tier: typed B is always an 8 and typed S always a 5."""

    @classmethod
    def setUpClass(cls):
        cls.codec = Baseh(baseh_medium_v1())

    def _first_code_with(self, sym):
        for value in range(1, 5_000_000):
            try:
                # Blocklisted identifiers are reserved and never issued; skip.
                code = self.codec.encode(value)
            except BasehError as err:
                self.assertEqual(err.code, BLOCKED_CODE)
                continue
            if sym in code:
                return value, code
        self.fail(f"no medium code contains {sym} in range")

    def test_typed_b_decodes_as_8(self):
        value, code = self._first_code_with("8")
        result = self.codec.decode(code.replace("8", "B"))
        self.assertEqual(result.id, value)
        # Aliases canonicalize during normalization, so the corrected flag
        # stays false; only confusion-map correction sets it.
        self.assertFalse(result.corrected)

    def test_typed_s_decodes_as_5_and_lowercase_works(self):
        value, code = self._first_code_with("5")
        self.assertEqual(self.codec.decode(code.replace("5", "S")).id, value)
        self.assertEqual(self.codec.decode(code.replace("5", "s")).id, value)

    def test_encode_never_emits_b_or_s(self):
        for value in range(5000):
            try:
                code = self.codec.encode(value)
            except BasehError as err:
                # Blocklisted identifiers are reserved and never issued; skip.
                self.assertEqual(err.code, BLOCKED_CODE)
                continue
            self.assertNotIn("B", code)
            self.assertNotIn("S", code)

    def test_genuinely_wrong_symbol_still_fails_checksum(self):
        _, code = self._first_code_with("8")
        wrong = code.replace("8", "7")
        with self.assertRaises(BasehError) as ctx:
            self.codec.decode(wrong)
        self.assertEqual(ctx.exception.code, INVALID_CHECKSUM)


class TestCorrectionFilter(unittest.TestCase):
    def test_ignores_map_replacements_the_alphabet_cannot_contain(self):
        # baseh-medium drops B, S and T. A P in the body under confusion light
        # would suggest a T that can never validate; that candidate must be
        # skipped and the failure reported as INVALID_CHECKSUM, never thrown
        # as INVALID_CHARACTER from the checksum step.
        codec = Baseh(baseh_medium_v1())
        code = ""
        for value in range(100_000, 1_000_000):
            code = codec.encode(value)
            if "P" in code:
                break
        bad = code[:-1] + ("3" if code.endswith("2") else "2")
        with self.assertRaises(BasehError) as ctx:
            codec.decode(bad, try_correction=True, confusion_profile="light")
        self.assertEqual(ctx.exception.code, INVALID_CHECKSUM)


class TestFuzz(unittest.TestCase):
    """Random ASCII and unicode inputs must only ever raise BasehError."""

    @classmethod
    def setUpClass(cls):
        cls.codec = Baseh(_base_profile())

    def test_fuzz(self):
        rng = random.Random(20260730)
        codepoints = (
            [ord(c) for c in string.printable]
            + list(range(0x00, 0x20))
            + list(range(0x7F, 0x400))
            + [0x4E2D, 0x0416, 0x1F600, 0x200B, 0x00DF]
        )
        for _ in range(4000):
            length = rng.randrange(0, 40)
            text = "".join(chr(rng.choice(codepoints)) for _ in range(length))
            try:
                self.codec.decode(
                    text,
                    accept_spaces=rng.random() < 0.5,
                    try_correction=rng.random() < 0.5,
                    confusion_profile=rng.choice(
                        ["none", "light", "medium", "heavy"]
                    ),
                )
            except BasehError:
                pass
            # Any other exception escapes and fails the test.


if __name__ == "__main__":
    unittest.main()
