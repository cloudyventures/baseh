import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  Baseh, BasehError, encodeBaseN, generateCandidates, calculateChecksum, prepareProfile,
  basehMinimumV1, basehLightV1, basehMediumV1, basehHeavyV1,
  basehMinimumPV1, basehLightPV1, basehMediumPV1, basehHeavyPV1,
  inversePermute, permute
} from "../src/index.js";
import type { BasehProfile } from "../src/index.js";

const TEST_KEY = new TextEncoder().encode("test-only-key-material-0001");
const TEST_KEY2 = new TextEncoder().encode("test-only-key-material-0002");
const ALPHA32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function profile(overrides: Partial<BasehProfile> = {}): BasehProfile {
  return {
    profileId: "test-prof",
    bodyAlphabet: "0123456789ABCDEF",
    bodyLength: 4,
    checksumAlphabet: "234679ACDEFGHJKMNPQRTUVWXY",
    checksumLength: 1,
    caseSensitive: false,
    separator: "-",
    grouping: [2, 2, 1],
    aliases: { O: "0", I: "1", L: "1" },
    permutation: { enabled: false },
    ...overrides
  };
}

/**
 * Test-local profile with the classic 32-symbol body and 26-symbol checksum
 * alphabet (modulus 26), used so the checksum and correction suites exercise
 * the documented modulus-26 behaviour directly. No profanity, no permutation.
 */
function alpha32Profile(overrides: Partial<BasehProfile> = {}): BasehProfile {
  return {
    profileId: "test-frozen",
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

describe("profile validation", () => {
  const bad: Array<[string, Partial<BasehProfile>]> = [
    ["empty id", { profileId: "" }],
    ["one symbol alphabet", { bodyAlphabet: "A" }],
    ["duplicate body symbols", { bodyAlphabet: "00123456789ABCDEF" }],
    ["zero body length", { bodyLength: 0 }],
    ["body length over limit", { bodyLength: 33 }],
    ["negative checksum length", { checksumLength: -1 }],
    ["checksum alphabet too small", { checksumAlphabet: "A" }],
    ["separator in body alphabet", { separator: "A" }],
    ["alias target not canonical", { aliases: { O: "Z" } }],
    ["alias source canonical", { aliases: { A: "0" } }],
    ["alias chain", { aliases: { O: "0", X: "O" } }],
    ["group mismatch", { grouping: [2, 2, 2] }],
    ["missing permutation key", {
      permutation: { enabled: true, algorithm: "feistel-v1", keyId: "k", keyBytes: new Uint8Array(), rounds: 8 }
    }],
    ["odd rounds", {
      permutation: { enabled: true, algorithm: "feistel-v1", keyId: "k", keyBytes: TEST_KEY, rounds: 7 }
    }]
  ];
  for (const [name, over] of bad) {
    it(`rejects ${name}`, () => {
      assert.throws(() => new Baseh(profile(over)), (e: unknown) =>
        e instanceof BasehError && e.code === "INVALID_PROFILE");
    });
  }
  it("accepts frozen profiles", () => {
    assert.doesNotThrow(() => new Baseh(basehMinimumV1()));
    assert.doesNotThrow(() => new Baseh(basehLightV1()));
    assert.doesNotThrow(() => new Baseh(basehMediumV1()));
    assert.doesNotThrow(() => new Baseh(basehHeavyV1()));
    assert.doesNotThrow(() => new Baseh(basehMinimumPV1({ keyBytes: TEST_KEY })));
    assert.doesNotThrow(() => new Baseh(basehLightPV1({ keyBytes: TEST_KEY })));
    assert.doesNotThrow(() => new Baseh(basehMediumPV1({ keyBytes: TEST_KEY })));
    assert.doesNotThrow(() => new Baseh(basehHeavyPV1({ keyBytes: TEST_KEY })));
  });
  it("frozen profiles have the documented tiers and capacities", () => {
    assert.equal(new Baseh(basehMinimumV1()).capacity(), 2_176_782_336n);
    assert.equal(new Baseh(basehLightV1()).capacity(), 887_503_681n);
    assert.equal(new Baseh(basehMediumV1()).capacity(), 481_890_304n);
    assert.equal(new Baseh(basehHeavyV1()).capacity(), 308_915_776n);
    // Every plain tier permutes with the frozen published key; only the -p
    // variants take caller key material.
    for (const tier of [basehMinimumV1(), basehLightV1(), basehMediumV1(), basehHeavyV1()]) {
      assert.equal(tier.permutation.enabled, true);
      if (tier.permutation.enabled) assert.equal(tier.permutation.keyId, "frozen");
    }
    assert.equal(basehMediumPV1({ keyBytes: TEST_KEY }).permutation.enabled, true);
    assert.equal(basehMediumPV1({ keyBytes: TEST_KEY }).profileId, "baseh-medium-p-v1");
    // The frozen key and a private key scramble differently.
    const frozen = new Baseh(basehMediumV1());
    const privy = new Baseh(basehMediumPV1({ keyBytes: TEST_KEY }));
    assert.equal(frozen.decode(frozen.encode(123456n)).id, 123456n);
    assert.notEqual(frozen.encode(123456n), privy.encode(123456n));
    // New frozen shapes: no-separator was retired; minimum keeps zero
    // checksums at [3,3], the rest carry two at [4,4].
    assert.deepEqual(basehMinimumV1().grouping, [3, 3]);
    assert.equal(basehMinimumV1().checksumLength, 0);
    for (const tier of [basehLightV1(), basehMediumV1(), basehHeavyV1()]) {
      assert.equal(tier.checksumLength, 2);
      assert.equal(tier.separator, "-");
      assert.deepEqual(tier.grouping, [4, 4]);
    }
  });
});

describe("base-N", () => {
  const alpha = "0123456789ABCDEF";
  const cases: Array<[bigint, string]> = [
    [0n, "0000"], [1n, "0001"], [15n, "000F"], [16n, "0010"], [255n, "00FF"], [65535n, "FFFF"]
  ];
  for (const [id, text] of cases) {
    it(`${id} -> ${text}`, () => assert.equal(encodeBaseN(id, alpha, 4), text));
  }
});

describe("round-trip boundaries", () => {
  const h = new Baseh(profile());
  for (const id of [0n, 1n, 65534n, 65535n]) {
    it(`round-trips ${id}`, () => assert.equal(h.decode(h.encode(id)).id, id));
  }
  it("rejects id == capacity", () => {
    assert.throws(() => h.encode(65536), (e: unknown) =>
      e instanceof BasehError && e.code === "OUT_OF_RANGE");
  });
});

describe("checksum", () => {
  it("is deterministic and profile sensitive", () => {
    const h1 = new Baseh(profile());
    assert.equal(h1.encode(0x1234), h1.encode(0x1234));
    const h2 = new Baseh(profile({ profileId: "test-other" }));
    assert.notEqual(h1.encode(1), h2.encode(1));
  });
  it("delta-26 substitution passes a modulus-26 checksum (documented limit)", () => {
    const h = new Baseh(alpha32Profile());
    // Find a body containing a low-value symbol (value <= 5) so +26 stays in range.
    let mutated: string | null = null;
    let suffix = "";
    let baseId = 0n;
    for (let id = 0n; id < 1_000_000n && mutated === null; id += 12_345n) {
      const raw = h.encode(id).replaceAll("-", "");
      const body = raw.slice(0, 6);
      for (let p = 0; p < 6; p += 1) {
        const v = ALPHA32.indexOf(body[p] as string);
        if (v >= 0 && v <= 5) {
          mutated = body.slice(0, p) + ALPHA32[v + 26] + body.slice(p + 1);
          suffix = raw.slice(6);
          baseId = id;
          break;
        }
      }
    }
    assert.ok(mutated, "expected a low-value symbol in a sampled body");
    // Validation succeeds silently but resolves to a different record.
    assert.notEqual(h.decode(mutated + suffix).id, baseId);
  });
  it("two checksum symbols detect every single-symbol substitution (sampled exhaustive)", () => {
    const h = new Baseh(alpha32Profile({ profileId: "test-strong", checksumLength: 2 }));
    // Sample bodies, then substitute every position with every wrong symbol.
    const sample = ["000000", "0000PB", "ABCDEF", "ZZZZZZ", "123ABC", "MNPQRS"];
    for (const body of sample) {
      const check = calculateChecksum(h.profile, body);
      for (let pos = 0; pos < 6; pos += 1) {
        for (const sym of ALPHA32) {
          if (sym === body[pos]) continue;
          const wrong = body.slice(0, pos) + sym + body.slice(pos + 1);
          assert.notEqual(calculateChecksum(h.profile, wrong), check,
            `undetected substitution ${body} pos ${pos} -> ${sym}`);
        }
      }
    }
  });
});

describe("aliases and normalization", () => {
  const h = new Baseh(profile());
  it("O decodes as 0, I and L decode as 1", () => {
    const canonical = h.encode(257n);
    const aliased = h.decode(canonical.replaceAll("0", "O").replaceAll("1", "I"));
    assert.equal(aliased.id, 257n);
    assert.equal(aliased.corrected, false);
  });
  it("encoder never emits alias sources", () => {
    for (let id = 0; id < 65535; id += 251) {
      assert.doesNotMatch(h.encode(id), /[OIL]/);
    }
  });
  it("lowercase input decodes", () => {
    const code = h.encode(0xabc);
    assert.equal(h.decode(code.toLowerCase()).id, 0xabcn);
  });
  it("rejects unknown symbol", () => {
    assert.throws(() => h.decode("00-0@-A"), (e: unknown) =>
      e instanceof BasehError && e.code === "INVALID_CHARACTER");
  });
  it("rejects wrong length", () => {
    assert.throws(() => h.decode("00-00-0A"), (e: unknown) =>
      e instanceof BasehError && e.code === "INVALID_LENGTH");
  });
  it("trims whitespace; inner spaces only when enabled", () => {
    const code = h.encode(1n);
    assert.equal(h.decode(`  ${code}  \n`).id, 1n);
    assert.equal(h.decode(code, { acceptSpaces: true }).id, 1n);
  });
});

describe("stripped leading zeros (spec 3.4)", () => {
  // The frozen tiers permute, so spec 3.4 padding is exercised against
  // non-permuting clones of the new 8-char Medium and 6-char Minimum shapes.
  // The repetition filter (spec 21) is off in these clones: the frozen tiers
  // ship maxRepetition 4, under which zero-heavy low ids are unissuable and
  // decode would report BLOCKED_CODE before the padding leniency mattered.
  const medium = new Baseh({ ...basehMediumV1(), profileId: "test-medium", permutation: { enabled: false }, maxRepetition: 0 });
  const minimum = new Baseh({ ...basehMinimumV1(), profileId: "test-minimum", permutation: { enabled: false }, maxRepetition: 0 });
  it("re-pads a code that lost leading zero body symbols", () => {
    assert.equal(medium.decode("XR").id, 0n);   // "000000XR"
    assert.equal(medium.decode("1XU").id, 1n);  // "000001XU"
    assert.equal(medium.decode("ZYY").id, 27n); // "00000ZYY"
  });
  it("works with lowercase in the stripped form", () => {
    assert.equal(medium.decode("xr").id, 0n);
    assert.equal(medium.decode("zyy").id, 27n);
  });
  it("full-width input is unchanged", () => {
    assert.equal(medium.decode("000001XU").id, 1n);
    assert.equal(medium.decode("0000-01XU").id, 1n);
  });
  it("a short code that is not a stripped valid code fails the checksum, not the length", () => {
    assert.throws(() => medium.decode("12"), (e: unknown) =>
      e instanceof BasehError && e.code === "INVALID_CHECKSUM");
  });
  it("empty input stays a length error", () => {
    assert.throws(() => medium.decode(""), (e: unknown) =>
      e instanceof BasehError && e.code === "INVALID_LENGTH");
  });
  it("over-long input stays a length error", () => {
    assert.throws(() => medium.decode("00000000XR"), (e: unknown) =>
      e instanceof BasehError && e.code === "INVALID_LENGTH");
  });
  it("no-checksum profiles pad too, except a fully stripped (empty) code", () => {
    assert.equal(minimum.decode("0").id, 0n);
    assert.throws(() => minimum.decode(""), (e: unknown) =>
      e instanceof BasehError && e.code === "INVALID_LENGTH");
  });
  it("canonical output stays fixed width", () => {
    assert.equal(medium.encode(0n), "0000-00XR");
  });
});

describe("look-alike aliases on frozen tiers", () => {
  const medium = new Baseh(basehMediumV1());
  function firstCodeWith(sym: string): { id: bigint; code: string } {
    for (let id = 1n; id < 5000000n; id += 1n) {
      const code = medium.encode(id);
      if (code.includes(sym)) return { id, code };
    }
    throw new Error(`no medium code contains ${sym} in range`);
  }
  it("typed B decodes as 8", () => {
    const { id, code } = firstCodeWith("8");
    assert.equal(medium.decode(code.replace("8", "B")).id, id);
  });
  it("typed S decodes as 5 and lowercase works", () => {
    const { id, code } = firstCodeWith("5");
    assert.equal(medium.decode(code.replace("5", "S")).id, id);
    assert.equal(medium.decode(code.replace("5", "s")).id, id);
  });
  it("aliasing is not reported as a correction", () => {
    const { code } = firstCodeWith("8");
    assert.equal(medium.decode(code.replace("8", "B")).corrected, false);
  });
  it("encode never emits B or S", () => {
    for (let id = 0n; id < 2000n; id += 1n) {
      try {
        assert.doesNotMatch(medium.encode(id), /[BS]/);
      } catch (e) {
        // Blocklisted identifiers are reserved and never issued; skip them.
        assert.ok(e instanceof BasehError && e.code === "BLOCKED_CODE");
      }
    }
  });
  it("a genuinely wrong symbol still fails the checksum", () => {
    const { code } = firstCodeWith("8");
    const wrong = code.replace("8", "7");
    assert.throws(() => medium.decode(wrong), (e: unknown) =>
      e instanceof BasehError && e.code === "INVALID_CHECKSUM");
  });
});

describe("correction", () => {
  const conf = alpha32Profile();
  const prepared = prepareProfile(conf);
  const h = new Baseh(conf);

  it("corrects a unique light-pair substitution", () => {
    const body = "0000PB";
    const check = calculateChecksum(prepared, body);
    const wrong = "0000TB" + check; // one T->P flip away from 0000PB
    const result = h.decode(wrong, { tryCorrection: true, confusionProfile: "light" });
    assert.equal(result.corrected, true);
    assert.equal(result.canonicalCode.replaceAll("-", ""), body + check);
  });
  it("returns AMBIGUOUS_INPUT for the constructed 0000BT case", () => {
    // 0000BT is one mapped flip from 0000BP (T->P) and from 0000DT (B->D);
    // checksum delta 4*37^0 + 2*37^1 = 78 == 0 mod 26, so both pass.
    const check = calculateChecksum(prepared, "0000BP");
    assert.throws(() => h.decode("0000BT" + check, { tryCorrection: true, confusionProfile: "light" }), (e: unknown) =>
      e instanceof BasehError && e.code === "AMBIGUOUS_INPUT" && !("id" in (e as object)));
  });
  it("INVALID_CHECKSUM when correction cannot help", () => {
    assert.throws(() => h.decode("ZZZZZZ" + calculateChecksum(prepared, "QQQQQQ"), { tryCorrection: true }),
      (e: unknown) => e instanceof BasehError && e.code === "INVALID_CHECKSUM");
  });
  it("respects maxCorrections 0", () => {
    const check = calculateChecksum(prepared, "0000PB");
    assert.throws(() => h.decode("0000TB" + check, { tryCorrection: true, maxCorrections: 0 }),
      (e: unknown) => e instanceof BasehError && e.code === "INVALID_CHECKSUM");
  });
  it("ignores map replacements the profile alphabet cannot contain", () => {
    // baseh-medium drops B, S and T. A P in the body under confusion light
    // would suggest a T that can never validate; that candidate must be
    // skipped and the failure reported as INVALID_CHECKSUM, never thrown as
    // INVALID_CHARACTER from the checksum step.
    const medium = new Baseh(basehMediumV1());
    let code = "";
    for (let id = 100000n; id < 1000000n; id += 1n) {
      code = medium.encode(id);
      if (code.includes("P")) break;
    }
    const bad = code.slice(0, -1) + (code.endsWith("2") ? "3" : "2");
    assert.throws(() => medium.decode(bad, { tryCorrection: true, confusionProfile: "light" }),
      (e: unknown) => e instanceof BasehError && e.code === "INVALID_CHECKSUM");
  });
  it("candidate cap", () => {
    const wide: Record<string, string[]> = {};
    for (const ch of ALPHA32) wide[ch] = ["A", "B", "C"];
    assert.throws(() => generateCandidates("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", wide, 1),
      (e: unknown) => e instanceof BasehError && e.code === "TOO_MANY_CANDIDATES");
  });
});

describe("permutation", () => {
  const key = { profileId: "perm-test", keyBytes: TEST_KEY, rounds: 8 };
  it("round-trips and stays in domain", () => {
    const capacity = 1_073_741_824n;
    for (const id of [0n, 1n, 31n, 32n, 1_073_741_823n, 500_000_000n]) {
      const p = permute(id, capacity, key);
      assert.ok(p >= 0n && p < capacity);
      assert.equal(inversePermute(p, capacity, key), id);
    }
  });
  it("is a bijection on a small domain", () => {
    const capacity = 100_000n;
    const seen = new Set<bigint>();
    for (let i = 0n; i < capacity; i += 1n) {
      seen.add(permute(i, capacity, key));
    }
    assert.equal(seen.size, Number(capacity));
  });
  it("different keys and profile ids produce different mappings", () => {
    const a = permute(7n, 1024n, key);
    const b = permute(7n, 1024n, { ...key, keyBytes: TEST_KEY2 });
    const c = permute(7n, 1024n, { ...key, profileId: "other" });
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });
  it("frozen profile round-trips with permutation on", () => {
    const h = new Baseh(basehMediumPV1({ keyBytes: TEST_KEY, keyId: "test-01" }));
    for (const id of [0n, 1n, 999n, 481_890_303n]) {
      assert.equal(h.decode(h.encode(id)).id, id);
    }
  });
});

describe("property tests", () => {
  it("round-trip for random ids on frozen profile", () => {
    const h = new Baseh(basehMediumV1());
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 481_890_303n }), (id) => {
      // The tier blocklist reserves some ids; skip those and round-trip the rest.
      let code: string;
      try {
        code = h.encode(id);
      } catch (e) {
        assert.ok(e instanceof BasehError && e.code === "BLOCKED_CODE");
        return;
      }
      assert.equal(h.decode(code).id, id);
    }), { numRuns: 200 });
  });
  it("canonical stability", () => {
    const h = new Baseh(profile());
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 65535n }), (id) => {
      const first = h.decode(h.encode(id));
      assert.equal(h.encode(first.id), first.canonicalCode);
    }), { numRuns: 200 });
  });
});

describe("fuzz smoke", () => {
  it("arbitrary strings never crash and only ever throw BasehError", () => {
    const h = new Baseh(profile());
    fc.assert(fc.property(fc.string({ maxLength: 64 }), (s) => {
      try {
        h.decode(s);
      } catch (e) {
        assert.ok(e instanceof BasehError);
        return;
      }
    }), { numRuns: 1000 });
  });
});
