"""Unit tests derived from spec sections 3, 5 and the test-suite document:
profile validation rejections, round trips and fuzz smoke."""

import random
import string
import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from base_human import (  # noqa: E402
    AMBIGUOUS_INPUT,
    INVALID_CHARACTER,
    INVALID_CHECKSUM,
    INVALID_LENGTH,
    INVALID_PROFILE,
    OUT_OF_RANGE,
    TOO_MANY_CANDIDATES,
    Hrc,
    HrcError,
    generate_candidates,
    hrc32_v1,
    hrc32s_v1,
)

_TEST_KEY = bytes.fromhex("746573742d6f6e6c792d6b65792d6d6174657269616c2d30303031")
_CAPACITY = 32 ** 6  # 1,073,741,824


def _base_profile() -> dict:
    return hrc32_v1(_TEST_KEY, "test-01")


class _ProfileCase(unittest.TestCase):
    def assertRejects(self, mutate, label):
        profile = _base_profile()
        mutate(profile)
        with self.subTest(case=label):
            try:
                Hrc(profile)
            except HrcError as err:
                self.assertEqual(err.code, INVALID_PROFILE, label)
            else:
                self.fail(f"profile accepted: {label}")


class TestProfileValidation(_ProfileCase):
    def test_rejections(self):
        cases = [
            (lambda p: p.update(profileId=""), "empty profile id"),
            (lambda p: p.update(bodyAlphabet="A"), "body alphabet too small"),
            (lambda p: p.update(bodyAlphabet="ABCA"), "duplicate body symbols"),
            (lambda p: p.update(bodyAlphabet="aA"), "case collision"),
            (lambda p: p.update(bodyAlphabet="0e9"), None),  # placeholder, replaced below
            (lambda p: p.update(bodyLength=0), "zero body length"),
            (lambda p: p.update(bodyLength=-1), "negative body length"),
            (lambda p: p.update(bodyLength=33), "body length above limit"),
            (lambda p: p.update(checksumLength=-1), "negative checksum length"),
            (lambda p: p.update(checksumAlphabet="2"), "checksum alphabet too small"),
            (lambda p: p.update(bodyAlphabet="0123456789ABCDEFGHJKMNPQRSTVWXY-"),
             "separator in body alphabet"),
            (lambda p: p.update(checksumAlphabet="234679ACDEFGHJKMNPQRTUVWXY"[: 25] + "-"),
             "separator in checksum alphabet"),
            (lambda p: p.update(aliases={"Z": "@"}), "alias target not canonical"),
            (lambda p: p.update(aliases={"Q": "O"}), "alias chain"),
            (lambda p: p.update(aliases={"Q": "Q"}), "alias cycle (source canonical)"),
            (lambda p: p.update(grouping=[3, 3]), "group total mismatch"),
            (lambda p: p["permutation"].pop("keyBytes"), "missing permutation key"),
            (lambda p: p["permutation"].update(rounds=5), "odd rounds"),
            (lambda p: p["permutation"].update(rounds=2), "too few rounds"),
            (lambda p: p["permutation"].update(rounds=18), "too many rounds"),
        ]
        # Non-ASCII symbol: build without an escape so the source stays ASCII.
        def non_ascii(p):
            p["bodyAlphabet"] = "01" + chr(0xE9)

        cases[4] = (non_ascii, "non-ascii symbol")
        for mutate, label in cases:
            self.assertRejects(mutate, label)

    def test_shipped_profiles_accepted(self):
        Hrc(_base_profile())
        Hrc(hrc32s_v1(_TEST_KEY, "test-01"))

    def test_zero_checksum_profile_accepted(self):
        profile = _base_profile()
        profile["checksumLength"] = 0
        profile["checksumAlphabet"] = ""
        profile["grouping"] = [3, 3]
        profile["aliases"] = {"O": "0", "I": "1", "L": "1"}
        Hrc(profile)


class TestRoundTrip(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.codec = Hrc(_base_profile())
        cls.codec_s = Hrc(hrc32s_v1(_TEST_KEY, "test-01"))

    def test_boundary_ids(self):
        boundary = [0, 1, 31, 32, 33, _CAPACITY - 2, _CAPACITY - 1]
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
                with self.assertRaises(HrcError) as ctx:
                    self.codec.encode(bad)
                self.assertEqual(ctx.exception.code, OUT_OF_RANGE)

    def test_capacity(self):
        self.assertEqual(self.codec.capacity(), 1073741824)
        self.assertEqual(self.codec_s.capacity(), 1073741824)

    def test_sequential_round_trip(self):
        codec = self.codec
        for value in range(10000):
            code = codec.encode(value)
            result = codec.decode(code)
            self.assertEqual(result.id, value)
            self.assertEqual(result.canonical_code, code)

    def test_raw_length(self):
        code = self.codec.encode(0)
        self.assertEqual(len(code.replace("-", "")), 7)
        code_s = self.codec_s.encode(0)
        self.assertEqual(len(code_s.replace("-", "")), 8)

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
            self.codec.validate("000-000-0"),
            {"valid": False, "reason": INVALID_CHECKSUM},
        )
        ok = self.codec.validate(self.codec.encode(7))
        self.assertTrue(ok["valid"])
        self.assertEqual(ok["canonical_code"], self.codec.encode(7))

    def test_length_and_character_errors(self):
        with self.assertRaises(HrcError) as ctx:
            self.codec.decode("000-00")
        self.assertEqual(ctx.exception.code, INVALID_LENGTH)
        with self.assertRaises(HrcError) as ctx:
            self.codec.decode("000-0@0-X")
        self.assertEqual(ctx.exception.code, INVALID_CHARACTER)

    def test_candidate_cap(self):
        # A confusion map wider than the built-ins that exceeds 64 candidates.
        wide = {"0": list("123456789ABCDEFG")}
        with self.assertRaises(HrcError) as ctx:
            generate_candidates("000000", wide)
        self.assertEqual(ctx.exception.code, TOO_MANY_CANDIDATES)


class TestFuzz(unittest.TestCase):
    """Random ASCII and unicode inputs must only ever raise HrcError."""

    @classmethod
    def setUpClass(cls):
        cls.codec = Hrc(_base_profile())

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
            except HrcError:
                pass
            # Any other exception escapes and fails the test.


if __name__ == "__main__":
    unittest.main()
