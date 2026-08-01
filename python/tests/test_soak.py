"""Round-trip soak suite, spec IMPLEMENTATION_SOAK_TESTS.md.

Two run levels share one implementation:

- CI subset (default): sweep capped at 100,000 ids per profile/variant and
  10,000 random samples. Runs inside the normal pytest run.
- Full soak (opt-in): sweep to min(1e9, capacity) per profile and 1,000,000
  random samples. Selected with BASEH_SOAK=1 (a skipUnless env guard, the
  pytest idiom named by the spec); skipped cleanly otherwise.

Environment overrides (all optional):

- BASEH_SOAK=1        run the full soak level
- BASEH_SOAK_SWEEP    override the sweep bound (smoke-testing the soak path)
- BASEH_SOAK_RANDOM   override the random sample count (spec section 4)
- BASEH_SOAK_SEED     override the random-phase seed (default 42)

Every shipped tier runs in two variants: permutation on (as shipped) and a
test-only permutation-off twin built by copying the profile dict and setting
``permutation`` to ``{"enabled": False}`` — the same twin pattern as the
repetition tests. For the expandable tier that single switch disables the
permutation across all generations, since the codec derives each generation's
Feistel key from the profile's permutation field (Baseh._feistel_key).
"""

import os
import random
import time
import unittest

from baseh import (
    BLOCKED_CODE,
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

# Fixed keyed-variant test key, spec section 2 (test keys live in tests only).
_TEST_KEY = bytes.fromhex(
    "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
)
_TEST_KEY_ID = "soak-test"

_SOAK = os.environ.get("BASEH_SOAK") == "1"
_CI_SWEEP_CAP = 100_000
_SEED = int(os.environ.get("BASEH_SOAK_SEED", "42"))
_RANDOM_COUNT = int(
    os.environ.get("BASEH_SOAK_RANDOM", "1000000" if _SOAK else "10000")
)
_SWEEP_OVERRIDE = os.environ.get("BASEH_SOAK_SWEEP")
_SWEEP_OVERRIDE = int(_SWEEP_OVERRIDE) if _SWEEP_OVERRIDE else None

_RANDOM_LO = 1_000_000_000
_RANDOM_HI = 100_000_000_000


def _tier_builders():
    """Every shipped tier: four fixed, their keyed -p variants, expandable."""
    return [
        ("baseh-minimum-v1", baseh_minimum_v1),
        ("baseh-minimum-p-v1", lambda: baseh_minimum_p_v1(_TEST_KEY, _TEST_KEY_ID)),
        ("baseh-light-v1", baseh_light_v1),
        ("baseh-light-p-v1", lambda: baseh_light_p_v1(_TEST_KEY, _TEST_KEY_ID)),
        ("baseh-medium-v1", baseh_medium_v1),
        ("baseh-medium-p-v1", lambda: baseh_medium_p_v1(_TEST_KEY, _TEST_KEY_ID)),
        ("baseh-heavy-v1", baseh_heavy_v1),
        ("baseh-heavy-p-v1", lambda: baseh_heavy_p_v1(_TEST_KEY, _TEST_KEY_ID)),
        ("baseh-expandable-v1", baseh_expandable_v1),
        ("baseh-expandable-p-v1", lambda: baseh_expandable_p_v1(_TEST_KEY, _TEST_KEY_ID)),
    ]


def _variants(profile):
    """Permutation on (as shipped) and the permutation-off test twin."""
    twin = dict(profile)
    twin["permutation"] = {"enabled": False}
    return [("permutation-on", profile), ("permutation-off", twin)]


def _full_sweep_bound(codec):
    """min(1e9, capacity) for fixed tiers; 1e9 for expandable, per spec."""
    if codec.profile.mode == "expandable":
        return 1_000_000_000
    return min(1_000_000_000, codec.capacity())


class _SoakBase(unittest.TestCase):
    def _fail_report(self, profile_id, variant, phase, id, code, stage, err):
        self.fail(
            f"soak failure: profile={profile_id} variant={variant} phase={phase} "
            f"seed={_SEED} id={id} code={code!r} stage={stage} error={err}"
        )

    def _report(self, profile_id, variant, phase, checked, blocked, elapsed):
        rate = int(checked / elapsed) if elapsed > 0 else checked
        print(
            f"soak: profile={profile_id} variant={variant} phase={phase} "
            f"checked={checked} blocked={blocked} elapsed={elapsed:.1f}s "
            f"throughput={rate}/s"
        )

    def _sweep(self, profile, variant, bound):
        profile_id = profile["profileId"]
        codec = Baseh(profile)
        blocked = 0
        checked = 0
        start = time.time()
        for id in range(bound):
            try:
                code = codec.encode(id)
            except BasehError as err:
                if err.code == BLOCKED_CODE:
                    # Repetition filter or blocklist: expected, not a failure.
                    blocked += 1
                    continue
                self._fail_report(profile_id, variant, "sweep", id, None, "encode", err)
            try:
                decoded = codec.decode(code)
            except BasehError as err:
                self._fail_report(profile_id, variant, "sweep", id, code, "decode", err)
            if decoded.id != id:
                self._fail_report(
                    profile_id, variant, "sweep", id, code, "roundtrip",
                    f"decoded id {decoded.id} != {id}",
                )
            checked += 1
        self._report(profile_id, variant, "sweep", checked, blocked, time.time() - start)

    def _random_phase(self, profile, variant, count):
        profile_id = profile["profileId"]
        codec = Baseh(profile)
        rng = random.Random(_SEED)
        blocked = 0
        checked = 0
        start = time.time()
        for _ in range(count):
            id = rng.randrange(_RANDOM_LO, _RANDOM_HI)
            try:
                code = codec.encode(id)
            except BasehError as err:
                if err.code == BLOCKED_CODE:
                    blocked += 1
                    continue
                self._fail_report(profile_id, variant, "random", id, None, "encode", err)
            try:
                decoded = codec.decode(code)
            except BasehError as err:
                self._fail_report(profile_id, variant, "random", id, code, "decode", err)
            if decoded.id != id:
                self._fail_report(
                    profile_id, variant, "random", id, code, "roundtrip",
                    f"decoded id {decoded.id} != {id}",
                )
            checked += 1
        self._report(profile_id, variant, "random", checked, blocked, time.time() - start)

    def _run_sweep_level(self, cap):
        for name, build in _tier_builders():
            profile = build()
            bound = _full_sweep_bound(Baseh(profile))
            if cap is not None:
                bound = min(bound, cap)
            for variant, variant_profile in _variants(profile):
                with self.subTest(profile=name, variant=variant):
                    self._sweep(variant_profile, variant, bound)

    def _run_random_level(self, count):
        print(f"soak random phase: seed={_SEED} count={count}")
        for name, build in _tier_builders():
            profile = build()
            if profile.get("mode") != "expandable":
                continue
            for variant, variant_profile in _variants(profile):
                with self.subTest(profile=name, variant=variant):
                    self._random_phase(variant_profile, variant, count)


class TestSoakSweepCISubset(_SoakBase):
    """Default CI level: 100,000-id sweep per shipped profile and variant."""

    def test_sweep_subset(self):
        self._run_sweep_level(_SWEEP_OVERRIDE if _SWEEP_OVERRIDE else _CI_SWEEP_CAP)


class TestSoakRandomCISubset(_SoakBase):
    """Default CI level: 10,000 random ids against the expandable tiers."""

    def test_random_subset(self):
        self._run_random_level(min(_RANDOM_COUNT, 10_000))


@unittest.skipUnless(_SOAK, "full soak is opt-in: set BASEH_SOAK=1")
class TestSoakFull(_SoakBase):
    """Full soak level, spec sections 3-4. Runs only with BASEH_SOAK=1."""

    def test_sweep_full(self):
        self._run_sweep_level(_SWEEP_OVERRIDE)

    def test_random_full(self):
        self._run_random_level(_RANDOM_COUNT)


if __name__ == "__main__":
    unittest.main()
