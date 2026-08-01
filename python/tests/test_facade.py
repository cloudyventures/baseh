"""Facade tests: the zero-config package-level encode/decode agree with a
manually-constructed Baseh on the frozen expandable v1 tier, round trip ids
including 0 and large values, and surface errors like the instance API."""

import unittest

from baseh import (
    Baseh,
    BasehError,
    DecodeResult,
    INVALID_CHECKSUM,
    OUT_OF_RANGE,
    baseh_expandable_v1,
    decode,
    encode,
)


class TestFacade(unittest.TestCase):
    def test_encode_returns_str(self):
        self.assertIsInstance(encode(42), str)

    def test_round_trip(self):
        for id in (0, 1, 42, 39303, 39304, 1_000_000, 1_336_335, 2**40):
            result = decode(encode(id))
            self.assertIsInstance(result, DecodeResult)
            self.assertEqual(result.id, id)

    def test_agrees_with_manual_instance(self):
        codec = Baseh(baseh_expandable_v1())
        for id in (0, 7, 12345, 999_999_999):
            code = encode(id)
            self.assertEqual(code, codec.encode(id))
            self.assertEqual(decode(code), codec.decode(code))

    def test_decode_error_matches_instance_api(self):
        codec = Baseh(baseh_expandable_v1())
        code = encode(5)
        bad = code[:-1] + ("0" if code[-1] != "0" else "1")
        with self.assertRaises(BasehError) as facade_ctx:
            decode(bad)
        with self.assertRaises(BasehError) as instance_ctx:
            codec.decode(bad)
        self.assertEqual(facade_ctx.exception.code, instance_ctx.exception.code)
        self.assertEqual(facade_ctx.exception.code, INVALID_CHECKSUM)

    def test_encode_out_of_range(self):
        with self.assertRaises(BasehError) as ctx:
            encode(-1)
        self.assertEqual(ctx.exception.code, OUT_OF_RANGE)


if __name__ == "__main__":
    unittest.main()
