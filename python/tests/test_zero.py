"""Unit tests for the zero-config pair (zero.py), mirroring js/test/zero.test.ts."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from baseh import (  # noqa: E402
    BLOCKED_CODE,
    INVALID_CHARACTER,
    INVALID_CHECKSUM,
    INVALID_LENGTH,
    OUT_OF_RANGE,
    Baseh,
    BasehError,
    baseh_medium_v1,
    from_code,
    to_code,
)

_MEDIUM = Baseh(baseh_medium_v1())


def _throws_code(fn, code):
    try:
        fn()
    except BasehError as err:
        if err.code == code:
            return
        raise AssertionError(f"expected code {code}, got {err.code}")
    raise AssertionError(f"expected BasehError({code}), no error raised")


class TestZeroConfig(unittest.TestCase):
    def test_matches_frozen_medium_profile(self):
        self.assertEqual(to_code(0), _MEDIUM.encode(0))
        self.assertEqual(to_code(123456789), _MEDIUM.encode(123456789))
        self.assertEqual(to_code(481890303), "ZZZZZZV")
        self.assertEqual(to_code(0), "000000C")

    def test_to_code_accepts_int_and_decimal_string(self):
        self.assertEqual(to_code(123456789), to_code("123456789"))
        with self.assertRaises((TypeError, ValueError)):
            to_code(-1)
        with self.assertRaises((TypeError, ValueError)):
            to_code("12x3")
        with self.assertRaises((TypeError, ValueError)):
            to_code("")
        with self.assertRaises((TypeError, ValueError)):
            to_code(1.5)
        with self.assertRaises((TypeError, ValueError)):
            to_code(None)

    def test_to_code_out_of_range_and_blocked(self):
        _throws_code(lambda: to_code(481890304), OUT_OF_RANGE)
        # 1131 is reserved by the Medium blocklist.
        _throws_code(lambda: to_code(1131), BLOCKED_CODE)

    def test_from_code_round_trip(self):
        id = from_code(to_code(123456789))
        self.assertIsInstance(id, int)
        self.assertEqual(id, 123456789)

    def test_from_code_accepts_lowercase_aliases_and_whitespace(self):
        c = to_code(123456789)
        self.assertEqual(from_code(c.lower()), 123456789)
        spaced = "  " + c[:3] + " " + c[3:5] + "\t" + c[5:] + " "
        self.assertEqual(from_code(spaced), 123456789)
        # Typed aliases decode to canonical values.
        self.assertEqual(from_code("OOOOOOC"), 0)
        # A lowercase alias form of a real code resolves to the same id.
        self.assertEqual(from_code("74uy c19"), from_code("74UYC19"))

    def test_from_code_invalid_input_no_correction(self):
        _throws_code(lambda: from_code("0000000"), INVALID_CHECKSUM)
        _throws_code(lambda: from_code("!!!!!!!"), INVALID_CHARACTER)
        # B is not canonical in Medium and is not an alias; no correction guesses it.
        _throws_code(lambda: from_code("B00000C"), INVALID_CHARACTER)
        _throws_code(lambda: from_code(""), INVALID_LENGTH)


if __name__ == "__main__":
    unittest.main()
