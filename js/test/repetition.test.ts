import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Baseh, BasehError, calculateChecksum, prepareProfile,
  basehMinimumV1, basehLightV1, basehMediumV1, basehHeavyV1,
  basehMinimumPV1, basehLightPV1, basehMediumPV1, basehHeavyPV1,
  basehExpandableV1, basehExpandablePV1
} from "../src/index.js";
import type { BasehProfile, PreparedProfile } from "../src/index.js";

const TEST_KEY = new TextEncoder().encode("test-only-key-material-0001");
const ALPHA32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function alpha32(overrides: Partial<BasehProfile> = {}): BasehProfile {
  return {
    profileId: "rep-test",
    bodyAlphabet: ALPHA32,
    bodyLength: 6,
    checksumAlphabet: "234679ACDEFGHJKMNPQRTUVWXY",
    checksumLength: 1,
    caseSensitive: false,
    separator: "",
    grouping: [],
    aliases: { O: "0", I: "1", L: "1" },
    permutation: { enabled: false },
    ...overrides
  };
}

function maxRun(raw: string): number {
  let best = 1;
  let run = 1;
  for (let i = 1; i < raw.length; i += 1) {
    run = raw[i] === raw[i - 1] ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/** First id whose raw code (per a filter-free twin) has max run exactly n. */
function findIdWithRun(profile: BasehProfile, n: number, limit = 5_000_000n): bigint {
  const twin = new Baseh({ ...profile, maxRepetition: 0, profanity: { mode: "none" as const } });
  for (let id = 0n; id < limit; id += 1n) {
    const raw = twin.encode(id).replaceAll("-", "");
    if (maxRun(raw) === n) return id;
  }
  throw new Error(`no id with max run ${n} below ${limit}`);
}

function throwsBlocked(fn: () => unknown): void {
  assert.throws(fn, (e: unknown) => e instanceof BasehError && e.code === "BLOCKED_CODE");
}

describe("repetition filter validation (spec 21)", () => {
  it("rejects 1 and 2, accepts 0 and 3", () => {
    for (const bad of [1, 2]) {
      assert.throws(() => prepareProfile(alpha32({ maxRepetition: bad })), (e: unknown) =>
        e instanceof BasehError && e.code === "INVALID_PROFILE");
    }
    assert.equal(prepareProfile(alpha32({ maxRepetition: 0 })).maxRepetition, 0);
    assert.equal(prepareProfile(alpha32({ maxRepetition: 3 })).maxRepetition, 3);
    // A value above the code length is a legal no-op.
    assert.equal(prepareProfile(alpha32({ maxRepetition: 99 })).maxRepetition, 99);
  });
  it("defaults to 0 (off)", () => {
    assert.equal(prepareProfile(alpha32()).maxRepetition, 0);
  });
});

describe("repetition filter encode (spec 21)", () => {
  const profile = alpha32({ maxRepetition: 4 });
  const h = new Baseh(profile);

  it("blocks a run of exactly 4", () => {
    throwsBlocked(() => h.encode(findIdWithRun(profile, 4)));
  });
  it("allows a run of exactly 3 (boundary)", () => {
    const id = findIdWithRun(profile, 3);
    assert.equal(h.decode(h.encode(id)).id, id);
  });
  it("is off at 0", () => {
    const off = new Baseh(alpha32({ maxRepetition: 0 }));
    const id = findIdWithRun(profile, 4);
    assert.equal(off.decode(off.encode(id)).id, id);
  });
  it("custom maxRepetition 3 blocks triples", () => {
    const three = alpha32({ maxRepetition: 3 });
    throwsBlocked(() => new Baseh(three).encode(findIdWithRun(three, 3)));
  });
  it("separators do not break a run", () => {
    // body "AAAA" renders AA-AA...: no formatted group shows a run of 4, but
    // the raw code is AAAA + checksum, a run of 4, so the filter fires.
    const sep: BasehProfile = {
      profileId: "rep-sep-test",
      bodyAlphabet: "0123456789ABCDEF",
      bodyLength: 4,
      checksumAlphabet: "234679ACDEFGHJKMNPQRTUVWXY",
      checksumLength: 1,
      caseSensitive: false,
      separator: "-",
      grouping: [2, 2, 1],
      aliases: {},
      permutation: { enabled: false },
      maxRepetition: 4
    };
    const id = 10n * 16n ** 3n + 10n * 16n ** 2n + 10n * 16n + 10n; // body AAAA
    const twin = new Baseh({ ...sep, maxRepetition: 0 });
    assert.match(twin.encode(id), /^AA-AA/);
    throwsBlocked(() => new Baseh(sep).encode(id));
  });
  it("issuance skips a blocked id by advancing", () => {
    const blocked = findIdWithRun(profile, 4);
    let id = blocked;
    let code: string | undefined;
    while (code === undefined) {
      try {
        code = h.encode(id);
      } catch (e) {
        assert.ok(e instanceof BasehError && e.code === "BLOCKED_CODE");
        id += 1n;
      }
    }
    assert.equal(h.decode(code).id, id);
  });
});

describe("repetition filter decode (spec 21.3)", () => {
  const profile = alpha32({ maxRepetition: 4 });
  const h = new Baseh(profile);
  const twin = new Baseh(alpha32({ maxRepetition: 0 }));

  it("decode reports BLOCKED_CODE for a code that could never be issued", () => {
    const code = twin.encode(findIdWithRun(profile, 4));
    throwsBlocked(() => h.decode(code));
  });
  it("correction never corrects into a blocked code", () => {
    // "00BBBB" is one light-confusion flip (D->B) from the presented body
    // "00DBBB"; the sole checksum-matching candidate carries a run of 4, so
    // decode surfaces BLOCKED_CODE instead of returning the corrected code.
    const prepared = prepareProfile(alpha32());
    const check = calculateChecksum(prepared, "00BBBB");
    throwsBlocked(() =>
      h.decode("00DBBB" + check, { tryCorrection: true, confusionProfile: "light" }));
  });
});

describe("frozen tiers ship maxRepetition 4 (spec 21.4)", () => {
  const tiers: Array<[string, () => BasehProfile]> = [
    ["baseh-minimum-v1", basehMinimumV1],
    ["baseh-light-v1", basehLightV1],
    ["baseh-medium-v1", basehMediumV1],
    ["baseh-heavy-v1", basehHeavyV1],
    ["baseh-minimum-p-v1", () => basehMinimumPV1({ keyBytes: TEST_KEY })],
    ["baseh-light-p-v1", () => basehLightPV1({ keyBytes: TEST_KEY })],
    ["baseh-medium-p-v1", () => basehMediumPV1({ keyBytes: TEST_KEY })],
    ["baseh-heavy-p-v1", () => basehHeavyPV1({ keyBytes: TEST_KEY })],
    ["baseh-expandable-v1", basehExpandableV1],
    ["baseh-expandable-p-v1", () => basehExpandablePV1({ keyBytes: TEST_KEY })]
  ];
  for (const [name, build] of tiers) {
    it(`${name} blocks a doctored 4-run id`, () => {
      const profile = build();
      const prepared: PreparedProfile = prepareProfile(profile);
      assert.equal(prepared.maxRepetition, 4);
      const h = new Baseh(profile);
      const id = findIdWithRun(profile, 4);
      throwsBlocked(() => h.encode(id));
    });
  }
});
