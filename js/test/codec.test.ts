import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  Hrc, HrcError, encodeBaseN, generateCandidates, calculateChecksum, prepareProfile,
  hrc32V1, hrc32sV1, inversePermute, permute
} from "../src/index.js";
import type { HrcProfile } from "../src/index.js";

const TEST_KEY = new TextEncoder().encode("test-only-key-material-0001");
const TEST_KEY2 = new TextEncoder().encode("test-only-key-material-0002");
const ALPHA32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function profile(overrides: Partial<HrcProfile> = {}): HrcProfile {
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

function frozenNoPerm(): HrcProfile {
  const p = hrc32V1({ keyBytes: TEST_KEY, keyId: "test-01" });
  return { ...p, permutation: { enabled: false } };
}

describe("profile validation", () => {
  const bad: Array<[string, Partial<HrcProfile>]> = [
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
      assert.throws(() => new Hrc(profile(over)), (e: unknown) =>
        e instanceof HrcError && e.code === "INVALID_PROFILE");
    });
  }
  it("accepts frozen profiles", () => {
    assert.doesNotThrow(() => new Hrc(hrc32V1({ keyBytes: TEST_KEY, keyId: "test-01" })));
    assert.doesNotThrow(() => new Hrc(hrc32sV1({ keyBytes: TEST_KEY, keyId: "test-01" })));
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
  const h = new Hrc(profile());
  for (const id of [0n, 1n, 65534n, 65535n]) {
    it(`round-trips ${id}`, () => assert.equal(h.decode(h.encode(id)).id, id));
  }
  it("rejects id == capacity", () => {
    assert.throws(() => h.encode(65536), (e: unknown) =>
      e instanceof HrcError && e.code === "OUT_OF_RANGE");
  });
});

describe("checksum", () => {
  it("is deterministic and profile sensitive", () => {
    const h1 = new Hrc(profile());
    assert.equal(h1.encode(0x1234), h1.encode(0x1234));
    const h2 = new Hrc(profile({ profileId: "test-other" }));
    assert.notEqual(h1.encode(1), h2.encode(1));
  });
  it("delta-26 substitution passes hrc32-v1 checksum (documented limit)", () => {
    const h = new Hrc(hrc32V1({ keyBytes: TEST_KEY, keyId: "test-01" }));
    const raw = h.encode(123456789n).replaceAll("-", "");
    const body = raw.slice(0, 6);
    let mutated: string | null = null;
    for (let p = 0; p < 6; p += 1) {
      const v = ALPHA32.indexOf(body[p] as string);
      if (v >= 0 && v <= 5) {
        mutated = body.slice(0, p) + ALPHA32[v + 26] + body.slice(p + 1);
        break;
      }
    }
    assert.ok(mutated, "expected a low-value symbol in the sample body");
    // Validation succeeds silently but resolves to a different record.
    assert.notEqual(h.decode(mutated + raw.slice(6)).id, 123456789n);
  });
  it("hrc32s-v1 detects every single-symbol substitution (sampled exhaustive)", () => {
    const prepared = prepareProfile(frozenNoPerm());
    const h = new Hrc({ ...frozenNoPerm(), profileId: "hrc32s-v1", checksumLength: 2, grouping: [3, 3, 2] });
    void prepared;
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
  const h = new Hrc(profile());
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
      e instanceof HrcError && e.code === "INVALID_CHARACTER");
  });
  it("rejects wrong length", () => {
    assert.throws(() => h.decode("00-0-A"), (e: unknown) =>
      e instanceof HrcError && e.code === "INVALID_LENGTH");
  });
  it("trims whitespace; inner spaces only when enabled", () => {
    const code = h.encode(1n);
    assert.equal(h.decode(`  ${code}  \n`).id, 1n);
    assert.equal(h.decode(code, { acceptSpaces: true }).id, 1n);
  });
});

describe("correction", () => {
  const conf = frozenNoPerm();
  const prepared = prepareProfile(conf);
  const h = new Hrc(conf);

  it("corrects a unique light-pair substitution", () => {
    const body = "0000PB";
    const check = calculateChecksum(prepared, body);
    const wrong = "0000TB" + check; // one T->P flip away from 0000PB
    const result = h.decode(wrong, { tryCorrection: true });
    assert.equal(result.corrected, true);
    assert.equal(result.canonicalCode.replaceAll("-", ""), body + check);
  });
  it("returns AMBIGUOUS_INPUT for the constructed 0000BT case", () => {
    // 0000BT is one mapped flip from 0000BP (T->P) and from 0000DT (B->D);
    // checksum delta 4*37^0 + 2*37^1 = 78 == 0 mod 26, so both pass.
    const check = calculateChecksum(prepared, "0000BP");
    assert.throws(() => h.decode("0000BT" + check, { tryCorrection: true }), (e: unknown) =>
      e instanceof HrcError && e.code === "AMBIGUOUS_INPUT" && !("id" in (e as object)));
  });
  it("INVALID_CHECKSUM when correction cannot help", () => {
    assert.throws(() => h.decode("ZZZZZZ" + calculateChecksum(prepared, "QQQQQQ"), { tryCorrection: true }),
      (e: unknown) => e instanceof HrcError && e.code === "INVALID_CHECKSUM");
  });
  it("respects maxCorrections 0", () => {
    const check = calculateChecksum(prepared, "0000PB");
    assert.throws(() => h.decode("0000TB" + check, { tryCorrection: true, maxCorrections: 0 }),
      (e: unknown) => e instanceof HrcError && e.code === "INVALID_CHECKSUM");
  });
  it("candidate cap", () => {
    const wide: Record<string, string[]> = {};
    for (const ch of ALPHA32) wide[ch] = ["A", "B", "C"];
    assert.throws(() => generateCandidates("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", wide, 1),
      (e: unknown) => e instanceof HrcError && e.code === "TOO_MANY_CANDIDATES");
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
    const h = new Hrc(hrc32V1({ keyBytes: TEST_KEY, keyId: "test-01" }));
    for (const id of [0n, 1n, 999n, 1_073_741_823n]) {
      assert.equal(h.decode(h.encode(id)).id, id);
    }
  });
});

describe("property tests", () => {
  it("round-trip for random ids on frozen profile", () => {
    const h = new Hrc(hrc32V1({ keyBytes: TEST_KEY, keyId: "test-01" }));
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 1_073_741_823n }), (id) => {
      assert.equal(h.decode(h.encode(id)).id, id);
    }), { numRuns: 200 });
  });
  it("canonical stability", () => {
    const h = new Hrc(profile());
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 65535n }), (id) => {
      const first = h.decode(h.encode(id));
      assert.equal(h.encode(first.id), first.canonicalCode);
    }), { numRuns: 200 });
  });
});

describe("fuzz smoke", () => {
  it("arbitrary strings never crash and only ever throw HrcError", () => {
    const h = new Hrc(profile());
    fc.assert(fc.property(fc.string({ maxLength: 64 }), (s) => {
      try {
        h.decode(s);
      } catch (e) {
        assert.ok(e instanceof HrcError);
        return;
      }
    }), { numRuns: 1000 });
  });
});
