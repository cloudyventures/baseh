"""Checksum single-substitution detection sweep, spec
IMPLEMENTATION_TEST_SUITE.md section 6.3.

For each checksummed frozen tier (Light, Medium and Heavy): over a sample of
random bodies, substitute every body position with every other canonical
symbol and record whether the checksum still matches. All three tiers ship
two checksum symbols and must show total detection: zero misses.

Two run levels share one implementation, matching tests/test_soak.py:

- CI subset (default): 2,000 sampled bodies per tier. Runs inside the normal
  pytest run.
- Full sweep (opt-in): 100,000 sampled bodies per tier, the spec's release
  gate. Selected with BASEH_SOAK=1; skipped cleanly otherwise.

Environment overrides (all optional):

- BASEH_SOAK=1          run the full 100,000-body sweep
- BASEH_SOAK_CHECKSUM   override the sampled body count
- BASEH_SOAK_SEED       override the sample seed (default 42)
"""

import os
import random
import unittest

from baseh import baseh_heavy_v1, baseh_light_v1, baseh_medium_v1
from baseh.basen import alphabet_index
from baseh.checksum import checksum_value
from baseh.profile import prepare_profile

_SOAK = os.environ.get("BASEH_SOAK") == "1"
_SEED = int(os.environ.get("BASEH_SOAK_SEED", "42"))
_BODY_COUNT = int(os.environ.get("BASEH_SOAK_CHECKSUM", "100000" if _SOAK else "2000"))

_TIERS = (
    ("baseh-light-v1", baseh_light_v1),
    ("baseh-medium-v1", baseh_medium_v1),
    ("baseh-heavy-v1", baseh_heavy_v1),
)


class _SweepBase(unittest.TestCase):
    def _sweep(self, name, build, body_count):
        profile = prepare_profile(build())
        alphabet = profile.body_alphabet_norm
        index = alphabet_index(alphabet)
        k = profile.checksum_length
        body_length = profile.body_length
        self.assertEqual(k, 2, f"{name} is expected to ship two checksum symbols")
        rng = random.Random(f"{_SEED}:{name}")
        misses = []
        checked = 0
        for _ in range(body_count):
            body = "".join(rng.choice(alphabet) for _ in range(body_length))
            before = checksum_value(profile, body, index, k)
            for pos in range(body_length):
                current = index[body[pos]]
                for value in range(len(alphabet)):
                    if value == current:
                        continue
                    candidate = body[:pos] + alphabet[value] + body[pos + 1 :]
                    checked += 1
                    if checksum_value(profile, candidate, index, k) == before:
                        misses.append((body, pos, alphabet[value]))
        self.assertEqual(
            misses,
            [],
            f"{name}: {len(misses)} undetected substitutions in "
            f"{checked} checks (first: {misses[:1]})",
        )

    def _run(self, body_count):
        print(f"checksum sweep: seed={_SEED} bodies={body_count} per tier")
        for name, build in _TIERS:
            with self.subTest(profile=name):
                self._sweep(name, build, body_count)


class TestChecksumSweepCISubset(_SweepBase):
    """Default CI level: 2,000 sampled bodies per checksummed frozen tier."""

    def test_substitution_subset(self):
        self._run(min(_BODY_COUNT, 2000))


@unittest.skipUnless(_SOAK, "full checksum sweep is opt-in: set BASEH_SOAK=1")
class TestChecksumSweepFull(_SweepBase):
    """Full 100,000-body release-gate sweep, spec section 6.3."""

    def test_substitution_full(self):
        self._run(_BODY_COUNT)


if __name__ == "__main__":
    unittest.main()
