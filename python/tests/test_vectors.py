"""Cross-language conformance vectors, vectors/vectors.json and
vectors/feistel-vectors.json. These files are the frozen contract; a release
fails if any supported implementation disagrees."""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from base_human import Hrc, HrcError  # noqa: E402
from base_human.feistel import FeistelKey, inverse_permute, permute  # noqa: E402

_VECTORS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "vectors")


def _load(name):
    with open(os.path.join(_VECTORS_DIR, name), "r", encoding="ascii") as fh:
        return json.load(fh)


def _build_profile(definition: dict) -> dict:
    """Convert an embedded profile definition to a codec-ready profile dict."""
    profile = dict(definition)
    permutation = dict(profile["permutation"])
    if permutation.get("enabled") and "keyBytesHex" in permutation:
        permutation["keyBytes"] = bytes.fromhex(permutation.pop("keyBytesHex"))
    profile["permutation"] = permutation
    return profile


class TestVectors(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        data = _load("vectors.json")
        cls.data = data
        cls.codecs = {}
        for entry in data["profiles"]:
            profile = _build_profile(entry["definition"])
            cls.codecs[entry["profileId"]] = Hrc(profile)

    def test_capacities(self):
        for entry in self.data["profiles"]:
            with self.subTest(profile_id=entry["profileId"]):
                codec = self.codecs[entry["profileId"]]
                self.assertEqual(str(codec.capacity()), entry["capacity"])

    def test_encode_vectors(self):
        count = 0
        for vector in self.data["vectors"]:
            if "canonicalCode" not in vector or "rawBody" not in vector:
                continue
            with self.subTest(profile_id=vector["profileId"], id=vector["id"]):
                codec = self.codecs[vector["profileId"]]
                self.assertEqual(codec.encode(int(vector["id"])), vector["canonicalCode"])
            count += 1
        self.assertGreater(count, 0)

    def test_decode_vectors(self):
        count = 0
        for vector in self.data["vectors"]:
            with self.subTest(profile_id=vector["profileId"], id=vector["id"]):
                codec = self.codecs[vector["profileId"]]
                input_text = vector.get("input", vector["canonicalCode"])
                result = codec.decode(input_text)
                self.assertEqual(str(result.id), vector["id"])
                self.assertEqual(result.canonical_code, vector["canonicalCode"])
                # Case, separator and whitespace fixes are normalization, not
                # correction; the corrected flag stays false for these inputs.
                self.assertFalse(result.corrected)
            count += 1
        self.assertGreater(count, 0)

    def test_error_vectors(self):
        count = 0
        for vector in self.data["errors"]:
            with self.subTest(input=vector["input"]):
                codec = self.codecs[vector["profileId"]]
                try:
                    codec.decode(vector["input"])
                except HrcError as err:
                    self.assertEqual(err.code, vector["error"])
                else:
                    self.fail(f"expected {vector['error']} for {vector['input']!r}")
            count += 1
        self.assertGreater(count, 0)

    def test_correction_vectors(self):
        # Frozen-vector quirk: the correction vectors were generated with the
        # hrc32-v1 checksum domain (the generator disables the permutation on
        # a clone of the hrc32-v1 profile rather than using the embedded
        # hrc32-noperm-test profileId). The vectors are frozen, so the
        # checksum domain here is "hrc32-v1" while every other field comes
        # from the embedded definition.
        codecs = dict(self.codecs)
        noperm_definition = _build_profile(
            next(
                e["definition"]
                for e in self.data["profiles"]
                if e["profileId"] == "hrc32-noperm-test"
            )
        )
        noperm_definition["profileId"] = "hrc32-v1"
        codecs["hrc32-noperm-test"] = Hrc(noperm_definition)

        for vector in self.data["correction"]:
            codec = codecs[vector["profileId"]]
            if "error" in vector:
                with self.subTest(input=vector["input"]):
                    for profile_name in ("light", "medium", "heavy"):
                        with self.assertRaises(HrcError) as ctx:
                            codec.decode(
                                vector["input"],
                                try_correction=True,
                                confusion_profile=profile_name,
                            )
                        self.assertEqual(ctx.exception.code, vector["error"])
            else:
                expected_code = None
                with self.subTest(input=vector["input"]):
                    for profile_name in ("light", "medium", "heavy"):
                        result = codec.decode(
                            vector["input"],
                            try_correction=True,
                            confusion_profile=profile_name,
                        )
                        self.assertTrue(result.corrected)
                        canonical_raw = result.canonical_code.replace("-", "")
                        body = canonical_raw[: len(vector["expectedBody"])]
                        self.assertEqual(body, vector["expectedBody"])
                        # The corrected code must round-trip inside this codec.
                        again = codec.decode(result.canonical_code)
                        self.assertEqual(again.id, result.id)
                        self.assertEqual(again.canonical_code, result.canonical_code)
                        self.assertFalse(again.corrected)
                        if expected_code is None:
                            expected_code = result.canonical_code
                        else:
                            self.assertEqual(result.canonical_code, expected_code)


class TestFeistelVectors(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = _load("feistel-vectors.json")

    def test_feistel_vectors(self):
        count = 0
        for vector in self.data["vectors"]:
            with self.subTest(
                capacity=vector["capacity"], input=vector["input"]
            ):
                key = FeistelKey(
                    profile_id=vector["profileId"],
                    key_bytes=bytes.fromhex(vector["keyBytesHex"]),
                    rounds=vector["rounds"],
                )
                capacity = int(vector["capacity"])
                value = int(vector["input"])
                expected = int(vector["permuted"])
                self.assertEqual(permute(value, capacity, key), expected)
                self.assertEqual(inverse_permute(expected, capacity, key), value)
            count += 1
        self.assertGreater(count, 0)


if __name__ == "__main__":
    unittest.main()
