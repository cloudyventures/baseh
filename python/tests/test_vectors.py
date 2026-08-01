"""Cross-language conformance vectors, vectors/vectors.json and
vectors/feistel-vectors.json. These files are the frozen contract; a release
fails if any supported implementation disagrees."""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from base_human import Baseh, BasehError  # noqa: E402
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
            cls.codecs[entry["profileId"]] = Baseh(profile)

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
                # Case fixes are normalization, not correction; the corrected
                # flag stays false for these inputs.
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
                except BasehError as err:
                    self.assertEqual(err.code, vector["error"])
                else:
                    self.fail(f"expected {vector['error']} for {vector['input']!r}")
            count += 1
        self.assertGreater(count, 0)

    def test_encode_error_vectors(self):
        count = 0
        for vector in self.data["encodeErrors"]:
            with self.subTest(profile_id=vector["profileId"], id=vector["id"]):
                codec = self.codecs[vector["profileId"]]
                try:
                    codec.encode(int(vector["id"]))
                except BasehError as err:
                    self.assertEqual(err.code, vector["error"])
                    if vector["error"] == "BLOCKED_CODE":
                        self.assertFalse(err.safe_for_customer)
                else:
                    self.fail(
                        f"expected {vector['error']} for id {vector['id']}"
                    )
            count += 1
        self.assertGreater(count, 0)

    def test_correction_vectors(self):
        for vector in self.data["correction"]:
            codec = self.codecs[vector["profileId"]]
            confusion_profile = vector.get("confusionProfile", "light")
            with self.subTest(input=vector["input"]):
                if "error" in vector:
                    with self.assertRaises(BasehError) as ctx:
                        codec.decode(
                            vector["input"],
                            try_correction=True,
                            confusion_profile=confusion_profile,
                        )
                    self.assertEqual(ctx.exception.code, vector["error"])
                else:
                    result = codec.decode(
                        vector["input"],
                        try_correction=True,
                        confusion_profile=confusion_profile,
                    )
                    self.assertTrue(result.corrected)
                    canonical_raw = result.canonical_code
                    separator = codec.profile.separator
                    if separator:
                        canonical_raw = canonical_raw.replace(separator, "")
                    body = canonical_raw[: len(vector["expectedBody"])]
                    self.assertEqual(body, vector["expectedBody"])
                    # The corrected code must round-trip inside this codec.
                    again = codec.decode(result.canonical_code)
                    self.assertEqual(again.id, result.id)
                    self.assertEqual(again.canonical_code, result.canonical_code)
                    self.assertFalse(again.corrected)


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
