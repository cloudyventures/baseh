import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Baseh, BasehError,
  basehMinimumV1, basehLightV1, basehMediumV1, basehHeavyV1,
  basehMinimumPV1, basehLightPV1, basehMediumPV1, basehHeavyPV1,
  basehExpandableV1, basehExpandablePV1
} from "../src/index.js";
import type { BasehProfile } from "../src/index.js";

/**
 * Round-trip soak suite (spec IMPLEMENTATION_SOAK_TESTS.md).
 *
 * Two run levels:
 *   - CI subset (default): sweep capped at 100,000 ids per profile,
 *     10,000 random samples. Runs in seconds as part of `npm test`.
 *   - Full soak (opt-in): `BASEH_SOAK=1 npm test` sweeps to
 *     min(1e9, capacity) per profile and draws 1,000,000 random samples.
 *
 * Knobs:
 *   BASEH_SOAK=1            select full-soak bounds
 *   BASEH_SOAK_SWEEP=<n>    override the sweep bound (smoke tests)
 *   BASEH_SOAK_RANDOM=<n>   override the random-sample count
 *   BASEH_SOAK_SEED=<n>     override the random-phase seed (default 42)
 */

const SOAK = process.env.BASEH_SOAK === "1";
const SEED = BigInt(process.env.BASEH_SOAK_SEED ?? "42");
const SWEEP_CAP = process.env.BASEH_SOAK_SWEEP
  ? BigInt(process.env.BASEH_SOAK_SWEEP)
  : SOAK ? 1_000_000_000n : 100_000n;
const RANDOM_COUNT = process.env.BASEH_SOAK_RANDOM
  ? BigInt(process.env.BASEH_SOAK_RANDOM)
  : SOAK ? 1_000_000n : 10_000n;

// Fixed test key from the spec (32 bytes, hex).
const SOAK_KEY = Uint8Array.from(
  Buffer.from("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff", "hex"));
const KEY_OPTS = { keyBytes: SOAK_KEY, keyId: "soak-test" };

const RANDOM_LO = 1_000_000_000n;
const RANDOM_HI = 100_000_000_000n;

/** Permutation-off twin: copy the shipped profile, disable its permutation. */
function withoutPermutation(profile: BasehProfile): BasehProfile {
  return { ...profile, permutation: { enabled: false } };
}

interface Tier {
  build: () => BasehProfile;
  /** Soak-level sweep bound; fixed tiers use their own capacity. */
  sweepBound: () => bigint;
}

function fixedTier(build: () => BasehProfile): Tier {
  return {
    build,
    sweepBound: () => {
      const cap = new Baseh(build()).capacity();
      return cap < 1_000_000_000n ? cap : 1_000_000_000n;
    }
  };
}

const FIXED_TIERS: Tier[] = [
  fixedTier(basehMinimumV1),
  fixedTier(basehLightV1),
  fixedTier(basehMediumV1),
  fixedTier(basehHeavyV1),
  fixedTier(() => basehMinimumPV1(KEY_OPTS)),
  fixedTier(() => basehLightPV1(KEY_OPTS)),
  fixedTier(() => basehMediumPV1(KEY_OPTS)),
  fixedTier(() => basehHeavyPV1(KEY_OPTS))
];

const EXPANDABLE_TIERS: Tier[] = [
  { build: basehExpandableV1, sweepBound: () => 1_000_000_000n },
  { build: () => basehExpandablePV1(KEY_OPTS), sweepBound: () => 1_000_000_000n }
];

/** splitmix64: seeded, deterministic, cheap. */
function rng(seed: bigint): () => bigint {
  let state = seed;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
    return z ^ (z >> 31n);
  };
}

function report(
  profileId: string, variant: string, phase: string,
  checked: bigint, blocked: bigint, start: bigint
): void {
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const rate = ms > 0 ? Math.round(Number(checked) / (ms / 1000)) : 0;
  console.log(
    `soak ${profileId} [${variant}] ${phase}: checked=${checked} blocked=${blocked} ` +
    `elapsed=${(ms / 1000).toFixed(2)}s throughput=${rate} ids/s`);
}

function sweep(profile: BasehProfile, variant: string, bound: bigint): void {
  const h = new Baseh(profile);
  const profileId = h.profile.profileId;
  let blocked = 0n;
  const start = process.hrtime.bigint();
  for (let id = 0n; id < bound; id += 1n) {
    let code: string;
    try {
      code = h.encode(id);
    } catch (e) {
      if (e instanceof BasehError && e.code === "BLOCKED_CODE") {
        blocked += 1n;
        continue;
      }
      throw e;
    }
    const decoded = h.decode(code).id;
    if (decoded !== id) {
      assert.fail(
        `soak mismatch profile=${profileId} variant=${variant} phase=sweep ` +
        `id=${id} code=${code} decoded=${decoded}`);
    }
  }
  report(profileId, variant, "sweep", bound - blocked, blocked, start);
}

function randomPhase(profile: BasehProfile, variant: string, count: bigint): void {
  const h = new Baseh(profile);
  const profileId = h.profile.profileId;
  const next = rng(SEED);
  const span = RANDOM_HI - RANDOM_LO;
  let blocked = 0n;
  const start = process.hrtime.bigint();
  for (let i = 0n; i < count; i += 1n) {
    const id = RANDOM_LO + (next() % span);
    let code: string;
    try {
      code = h.encode(id);
    } catch (e) {
      if (e instanceof BasehError && e.code === "BLOCKED_CODE") {
        blocked += 1n;
        continue;
      }
      throw e;
    }
    const decoded = h.decode(code).id;
    if (decoded !== id) {
      assert.fail(
        `soak mismatch profile=${profileId} variant=${variant} phase=random ` +
        `seed=${SEED} id=${id} code=${code} decoded=${decoded}`);
    }
  }
  report(profileId, variant, "random", count - blocked, blocked, start);
}

const variants: Array<[string, (p: BasehProfile) => BasehProfile]> = [
  ["permutation-on", (p) => p],
  ["permutation-off", withoutPermutation]
];

function soakDescribe(name: string, fn: () => void): void {
  // Full-soak bounds are opt-in via BASEH_SOAK=1; skipped cleanly otherwise.
  describe(name, { skip: !SOAK ? "set BASEH_SOAK=1 to run the full soak" : false }, fn);
}

for (const tier of [...FIXED_TIERS, ...EXPANDABLE_TIERS]) {
  for (const [variant, wrap] of variants) {
    const profile = wrap(tier.build());
    const profileId = profile.profileId;
    const bound = tier.sweepBound() < SWEEP_CAP ? tier.sweepBound() : SWEEP_CAP;

    it(`CI sweep ${profileId} [${variant}]`, () => {
      sweep(profile, variant, bound > 100_000n ? 100_000n : bound);
    });
    soakDescribe(`soak sweep ${profileId} [${variant}]`, () => {
      it("round trips every id to the soak bound", () => {
        sweep(profile, variant, bound);
      });
    });
  }
}

for (const tier of EXPANDABLE_TIERS) {
  for (const [variant, wrap] of variants) {
    const profile = wrap(tier.build());
    const profileId = profile.profileId;
    it(`CI random ${profileId} [${variant}] seed=${SEED}`, () => {
      randomPhase(profile, variant, 10_000n);
    });
    soakDescribe(`soak random ${profileId} [${variant}] seed=${SEED}`, () => {
      it("round trips random ids in [1e9, 1e11)", () => {
        randomPhase(profile, variant, RANDOM_COUNT);
      });
    });
  }
}
