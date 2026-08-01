"""Seeded property-style tests, spec IMPLEMENTATION_TEST_SUITE.md section 11.

Hypothesis is not a dependency, so the properties run as a seeded-random
loop in the existing unittest style (the same convention as the fuzz test in
test_codec.py). Each iteration builds a random valid fixed-mode profile by
mutating a fresh keyed helper profile and checks the core invariants over
random ids:

- 11.1 Round trip: decode(encode(id)).id == id.
- 11.2 Canonical stability: decode(canonical).canonical_code == canonical
  and the corrected flag is false.
- 11.4 Fixed length: every raw code is bodyLength + checksumLength symbols.
- 11.5 No emitted alias sources: encode never emits a symbol that an alias
  maps away from.

The seed is fixed so CI is deterministic; BASEH_SOAK_SEED overrides it,
matching tests/test_soak.py.
"""

import os
import random
import string
import unittest

from baseh import Baseh, BasehError, baseh_medium_p_v1

_SEED = int(os.environ.get("BASEH_SOAK_SEED", "20260801"))
_TEST_KEY = bytes.fromhex("746573742d6f6e6c792d6b65792d6d6174657269616c2d30303031")

_PROFILES = 100
_IDS_PER_PROFILE = 25


def _random_profile(rng):
    profile = baseh_medium_p_v1(_TEST_KEY)
    profile["profanity"] = {"mode": "none"}
    profile["maxRepetition"] = 0
    if rng.random() < 0.5:
        profile["permutation"] = {"enabled": False}
    checksum_length = rng.choice([0, 1, 2, 3])
    profile["checksumLength"] = checksum_length
    if checksum_length == 0:
        profile["checksumAlphabet"] = ""
    body_length = rng.choice([4, 5, 6])
    profile["bodyLength"] = body_length
    if rng.random() < 0.5:
        profile["separator"] = ""
        profile["grouping"] = []
    else:
        profile["separator"] = "-"
        # A balanced split of the total length into two groups.
        total = body_length + checksum_length
        profile["grouping"] = [total // 2, total - total // 2]
    profile["profileId"] = f"property-{rng.randrange(1_000_000)}"
    return profile


class TestProperties(unittest.TestCase):
    def test_round_trip_and_canonical_stability(self):
        rng = random.Random(_SEED)
        for _ in range(_PROFILES):
            profile = _random_profile(rng)
            codec = Baseh(profile)
            capacity = codec.capacity()
            alias_sources = set(profile.get("aliases", {}))
            # Normalization is case-insensitive here, so sources compare
            # uppercase; separator and grouping are excluded from the raw
            # length check.
            expected_raw = profile["bodyLength"] + profile["checksumLength"]
            for _ in range(_IDS_PER_PROFILE):
                id = rng.randrange(capacity)
                with self.subTest(profile_id=profile["profileId"], id=id):
                    code = codec.encode(id)
                    raw = code.replace(profile["separator"], "")
                    self.assertEqual(len(raw), expected_raw)
                    for source in alias_sources:
                        self.assertNotIn(source.upper(), raw.upper())
                    result = codec.decode(code)
                    self.assertEqual(result.id, id)
                    self.assertEqual(result.canonical_code, code)
                    self.assertFalse(result.corrected)
                    again = codec.decode(result.canonical_code)
                    self.assertEqual(again.canonical_code, code)
                    self.assertEqual(codec.encode(result.id), code)

    def test_random_printable_inputs_never_crash(self):
        # Property: any printable string either decodes or raises BasehError
        # (a stronger form of the validate() never-raises contract).
        rng = random.Random(_SEED + 1)
        codec = Baseh(baseh_medium_p_v1(_TEST_KEY))
        alphabet = string.printable
        for _ in range(2000):
            text = "".join(rng.choice(alphabet) for _ in range(rng.randrange(0, 24)))
            outcome = codec.validate(text)
            self.assertIn("valid", outcome)
            try:
                codec.decode(text)
            except BasehError as err:
                self.assertEqual(outcome["reason"], err.code)
            else:
                self.assertTrue(outcome["valid"])


if __name__ == "__main__":
    unittest.main()
