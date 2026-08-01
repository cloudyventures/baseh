import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Baseh, BasehError,
  basehExpandableV1, basehExpandablePV1, basehMediumV1,
  generationBase, generationCapacity, generationForId, expandableGrouping,
  prepareProfile, checksumValue, effectiveChecksumLength
} from "../src/index.js";
import { alphabetIndex } from "../src/index.js";
import type { BasehProfile } from "../src/index.js";

const TEST_KEY = new TextEncoder().encode("test-only-key-material-0001");

/** A custom expandable profile with no permutation and no blocklist. */
function customExpandable(overrides: Partial<BasehProfile> = {}): BasehProfile {
  return {
    profileId: "custom-expandable-test",
    mode: "expandable",
    bodyAlphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", // 0/O stripped at preparation
    minLength: 3,
    checksumAlphabet: "",
    checksumLength: 1,
    caseSensitive: false,
    separator: "",
    separatorMinLength: 0,
    grouping: [],
    aliases: { O: "0", I: "1", L: "1" },
    permutation: { enabled: false },
    ...overrides
  };
}

function raw(code: string): string {
  return code.replaceAll("-", "");
}

function expectError(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => e instanceof BasehError && e.code === code);
}

describe("expandable: frozen tier shape", () => {
  const h = new Baseh(basehExpandableV1());

  it("derives the prepared alphabets per spec 17.1/19.3", () => {
    assert.equal(h.profile.bodyAlphabetNorm, "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ");
    assert.equal(h.profile.bodyAlphabetNorm.length, 34);
    assert.equal(h.profile.checksumAlphabetNorm, "0123456789ABCDEFGHIJKLMNPQRSTUVWXYZ");
    assert.equal(h.profile.checksumAlphabetNorm.length, 35);
    assert.equal(h.profile.checksumModulus, 1225n);
    assert.equal(h.profile.mode, "expandable");
    assert.equal(h.profile.minLength, 4);
    assert.equal(h.profile.separatorMinLength, 6);
  });

  it("matches the generation table of spec 17.1", () => {
    // Short checksum on (spec 22): one checksum symbol through length 5,
    // two from 6 up, so generations 5 and 6 have equal capacity.
    const expected: Array<[number, string, string]> = [
      [4, "0", "39304"],
      [5, "39304", "1336336"],
      [6, "1375640", "1336336"],
      [7, "2711976", "45435424"],
      [8, "48147400", "1544804416"]
    ];
    for (const [l, base, cap] of expected) {
      assert.equal(generationBase(h.profile, l).toString(), base);
      assert.equal(generationCapacity(h.profile, l).toString(), cap);
    }
  });

  it("capacity() is fixed-mode only (spec 12.3)", () => {
    expectError(() => h.capacity(), "INVALID_PROFILE");
  });
});

describe("expandable: boundary round trips (spec 20.1)", () => {
  const h = new Baseh(basehExpandableV1());

  for (let l = 4; l <= 8; l += 1) {
    const base = generationBase(h.profile, l);
    const next = generationBase(h.profile, l + 1);
    for (const id of [base, next - 1n, next]) {
      it(`id ${id} encodes at generation ${l >= 8 && id === next ? "9" : l}`, () => {
        const code = h.encode(id);
        const expectedLength = generationForId(h.profile, id);
        assert.equal(raw(code).length, expectedLength);
        const d = h.decode(code);
        assert.equal(d.id, id);
        assert.equal(d.canonicalCode, code);
        assert.equal(d.corrected, false);
        // The zero ban makes a non-zero leading body symbol structural.
        assert.notEqual(raw(code)[0], "0");
        assert.notEqual(raw(code)[0], "O");
      });
    }
  }

  it("id 39303 is the last 4-character code, 39304 the first 5-character one", () => {
    assert.equal(raw(h.encode(39303n)).length, 4);
    assert.equal(raw(h.encode(39304n)).length, 5);
  });

  it("exhaustively round-trips every issuable id of generation 4", () => {
    let issued = 0;
    for (let id = 0n; id < 39304n; id += 1n) {
      let code: string;
      try {
        code = h.encode(id);
      } catch (e) {
        assert.ok(e instanceof BasehError && e.code === "BLOCKED_CODE");
        continue; // blocklisted ids are reserved, never issued (spec 18)
      }
      assert.equal(raw(code).length, 4);
      assert.equal(h.decode(code).id, id);
      issued += 1;
    }
    assert.ok(issued > 38500, `expected nearly all 39304 ids issuable, got ${issued}`);
  });

  it("round-trips boundaries on a custom expandable profile", () => {
    const c = new Baseh(customExpandable());
    // minLength 3, checksum 1, body 34: generation 3 holds 34^2 = 1156 ids.
    assert.equal(generationBase(c.profile, 3), 0n);
    assert.equal(generationBase(c.profile, 4), 1156n);
    for (const id of [0n, 1n, 1155n, 1156n, 40459n, 40460n]) {
      const code = c.encode(id);
      assert.equal(c.decode(code).id, id);
    }
    assert.equal(c.encode(1155n).length, 3);
    assert.equal(c.encode(1156n).length, 4);
  });
});

describe("expandable: 32-symbol ceiling (spec 19.6)", () => {
  const h = new Baseh(basehExpandableV1());

  it("rejects ids at or beyond generation 33", () => {
    expectError(() => h.encode(generationBase(h.profile, 33)), "OUT_OF_RANGE");
    expectError(() => h.encode(generationBase(h.profile, 33) + 1n), "OUT_OF_RANGE");
    expectError(() => generationForId(h.profile, generationBase(h.profile, 33)), "OUT_OF_RANGE");
    // The last id of generation 32 still encodes.
    assert.equal(raw(h.encode(generationBase(h.profile, 33) - 1n)).length, 32);
  });

  it("fails fast on an adversarial huge id instead of spinning the loop", () => {
    const huge = 10n ** 100000n;
    const start = performance.now();
    expectError(() => h.encode(huge), "OUT_OF_RANGE");
    assert.ok(performance.now() - start < 50, "encode of a huge id must fail in under 50ms");
  });
});

describe("expandable: zero ban (spec 20.2)", () => {
  const h = new Baseh(basehExpandableV1());

  it("presented 0 in a body position fails INVALID_CHARACTER", () => {
    const code = raw(h.encode(1000n));
    const withZero = "0" + code.slice(1);
    expectError(() => h.decode(withZero), "INVALID_CHARACTER");
  });

  it("presented O in a body position fails INVALID_CHARACTER after the O -> 0 alias", () => {
    const code = raw(h.encode(1000n));
    const withO = "O" + code.slice(1);
    expectError(() => h.decode(withO), "INVALID_CHARACTER");
  });

  it("a custom alphabet containing 0 and O is silently stripped and validates", () => {
    const p = prepareProfile(customExpandable());
    assert.ok(!p.bodyAlphabetNorm.includes("0"));
    assert.ok(!p.bodyAlphabetNorm.includes("O"));
    assert.equal(p.bodyAlphabetNorm, "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ");
  });

  it("body alphabet must not be left with fewer than two symbols", () => {
    expectError(
      () => new Baseh(customExpandable({ bodyAlphabet: "0O" })),
      "INVALID_PROFILE"
    );
  });
});

describe("expandable: checksum with zero (spec 20.3)", () => {
  const h = new Baseh(basehExpandableV1());

  it("codes whose checksum contains 0 encode, decode and round-trip", () => {
    const found: Array<[bigint, string]> = [];
    for (let id = 0n; id < 200000n && found.length < 8; id += 1n) {
      let code: string;
      try {
        code = h.encode(id);
      } catch {
        continue;
      }
      const r = raw(code);
      if (r.slice(-2).includes("0")) found.push([id, code]);
    }
    assert.ok(found.length >= 8, "expected checksum-with-zero codes in the sample");
    for (const [id, code] of found) {
      const d = h.decode(code);
      assert.equal(d.id, id);
      assert.equal(d.canonicalCode, code);
    }
  });

  it("typed O in a checksum position aliases to 0 and decodes to the same id", () => {
    // Spec 20.3 says "corrected true", but spec 9 defines corrected as
    // canonicalize(input) != canonicalize(canonical), and canonicalize
    // applies aliases — so an aliased input is NOT a correction. The
    // fixed-mode tests pin the same behaviour (aliased -> corrected false);
    // the codec spec wins.
    let pinned: [bigint, string] | null = null;
    for (let id = 0n; id < 500000n; id += 1n) {
      let code: string;
      try {
        code = h.encode(id);
      } catch {
        continue;
      }
      if (raw(code).endsWith("0")) {
        pinned = [id, code];
        break;
      }
    }
    assert.ok(pinned, "expected a code whose checksum ends in 0");
    const [id, code] = pinned;
    const r = raw(code);
    const typed = r.slice(0, -1) + "O";
    const d = h.decode(typed);
    assert.equal(d.id, id);
    assert.equal(d.canonicalCode, code);
    assert.equal(d.corrected, false);
  });

  it("detects every sampled single substitution and adjacent transposition at several generations", () => {
    // M = 1225 > 33 and gcd(36, 1225) = 1, so detection is provably total at
    // the full two-symbol checksum (spec 17.1). The short-checksum
    // generations (<= 5, spec 22) run modulus 35 and are excluded; the sweep
    // pins total detection at generations 6 and 8.
    for (const l of [6, 8]) {
      const base = generationBase(h.profile, l);
      const k = effectiveChecksumLength(h.profile, l);
      assert.equal(k, 2);
      const index = alphabetIndex(h.profile.bodyAlphabetNorm);
      const bodyLen = l - k;
      const alphabet = h.profile.bodyAlphabetNorm;
      let misses = 0;
      for (let id = base; id < base + 50n; id += 1n) {
        let code: string;
        try {
          code = h.encode(id);
        } catch {
          continue;
        }
        const r = raw(code);
        const body = r.slice(0, bodyLen);
        const before = checksumValue(h.profile, body, index, k);
        for (let pos = 0; pos < bodyLen; pos += 1) {
          const cur = index.get(body[pos] as string) as bigint;
          for (const delta of [1n, 5n, 17n]) {
            const nv = Number((cur + delta) % 34n);
            const candidate = body.slice(0, pos) + alphabet[nv] + body.slice(pos + 1);
            if (checksumValue(h.profile, candidate, index, k) === before) misses += 1;
          }
        }
        for (let pos = 0; pos + 1 < bodyLen; pos += 1) {
          if (body[pos] === body[pos + 1]) continue;
          const swapped = body.slice(0, pos) + body[pos + 1] + body[pos] + body.slice(pos + 2);
          if (checksumValue(h.profile, swapped, index, k) === before) misses += 1;
        }
      }
      assert.equal(misses, 0, `generation ${l} had ${misses} checksum misses`);
    }
  });
});

describe("expandable: no left padding (spec 20.4)", () => {
  const h = new Baseh(basehExpandableV1());

  it("input shorter than minLength fails INVALID_LENGTH", () => {
    expectError(() => h.decode("1"), "INVALID_LENGTH");
    expectError(() => h.decode("ABC"), "INVALID_LENGTH");
    expectError(() => h.decode(""), "INVALID_LENGTH");
  });

  it("input longer than 32 symbols fails INVALID_LENGTH", () => {
    expectError(() => h.decode("A".repeat(33)), "INVALID_LENGTH");
  });

  it("canonicalCode always has exactly the presented length", () => {
    for (const id of [0n, 1155n, 1156n, 40460n, 123456789n]) {
      const code = h.encode(id);
      const d = h.decode(code);
      assert.equal(raw(d.canonicalCode).length, raw(code).length);
    }
  });
});

describe("expandable: separator threshold (spec 20.5)", () => {
  const h = new Baseh(basehExpandableV1());

  it("lengths 4 and 5 render bare", () => {
    assert.ok(!h.encode(0n).includes("-"));
    assert.ok(!h.encode(1156n).includes("-"));
  });

  it("decoder rejects a separator below separatorMinLength", () => {
    const code = h.encode(0n);
    const withHyphen = code.slice(0, 2) + "-" + code.slice(2);
    expectError(() => h.decode(withHyphen), "INVALID_CHARACTER");
  });

  it("renders the pinned shapes for lengths 6 through 10", () => {
    const shapes: Record<number, RegExp> = {
      6: /^...-...$/,
      7: /^....-...$/,
      8: /^....-....$/,
      9: /^.....-....$/,
      10: /^.....-.....$/
    };
    for (const [l, shape] of Object.entries(shapes)) {
      const length = Number(l);
      const id = generationBase(h.profile, length);
      let code: string | null = null;
      for (let probe = id; probe < id + 5000n; probe += 1n) {
        try {
          code = h.encode(probe);
          break;
        } catch {
          continue;
        }
      }
      assert.ok(code, `no issuable id found at generation ${length}`);
      assert.match(code, shape, `generation ${length}: ${code}`);
      assert.equal(h.decode(code).canonicalCode, code);
    }
  });

  it("expandableGrouping follows the balanced rule (pinned table, spec 19.5)", () => {
    const pinned: Array<[number, number[]]> = [
      [4, [2, 2]],
      [5, [3, 2]],
      [6, [3, 3]],
      [7, [4, 3]],
      [8, [4, 4]],
      [9, [5, 4]],
      [10, [5, 5]],
      [11, [4, 4, 3]],
      [12, [4, 4, 4]],
      [13, [5, 4, 4]],
      [14, [5, 5, 4]],
      [15, [5, 5, 5]],
      [16, [4, 4, 4, 4]]
    ];
    for (const [length, sizes] of pinned) {
      assert.deepEqual(expandableGrouping(length), sizes, `length ${length}`);
    }
  });
});

describe("expandable: wrong-generation rejection (spec 20.6)", () => {
  const h = new Baseh(basehExpandableV1());

  it("a code with a symbol appended fails and never aliases the shorter id", () => {
    const id = 777n;
    const code = raw(h.encode(id));
    assert.equal(code.length, 4);
    for (const extra of ["1", "A", "Z"]) {
      const longer = code + extra; // 5 symbols: body split moves, checksum fails
      const result = h.validate(longer);
      assert.equal(result.valid, false);
      assert.ok(
        result.reason === "INVALID_CHECKSUM" || result.reason === "INVALID_CHARACTER",
        `unexpected reason ${result.reason}`
      );
      expectError(() => h.decode(longer), result.reason as string);
    }
  });

  it("a code with a symbol removed fails", () => {
    const code = raw(h.encode(40460n)); // generation 6
    const shorter = code.slice(1);
    const result = h.validate(shorter);
    assert.equal(result.valid, false);
  });

  it("correction never returns a candidate at a different length", () => {
    const code = h.encode(123456789n); // generation 8
    const r = raw(code);
    const pairs: Record<string, string> = { B: "D", D: "B", P: "T", T: "P", M: "N", N: "M", V: "W", W: "V" };
    let typo: string | null = null;
    for (let pos = 0; pos < r.length - 2 && typo === null; pos += 1) {
      const ch = r[pos] as string;
      if (ch in pairs) typo = r.slice(0, pos) + pairs[ch] + r.slice(pos + 1);
    }
    assert.ok(typo !== null, "expected a confusable body symbol in the sample code");
    const d = h.decode(typo, { tryCorrection: true, confusionProfile: "medium", maxCorrections: 1 });
    assert.equal(raw(d.canonicalCode).length, r.length);
    assert.equal(d.id, 123456789n);
  });
});

describe("expandable: keyed -p tier", () => {
  it("round trips across generations with caller key material", () => {
    const p = new Baseh(basehExpandablePV1({ keyBytes: TEST_KEY, keyId: "test-01" }));
    assert.equal(p.profile.profileId, "baseh-expandable-p-v1");
    for (const id of [0n, 1n, 1155n, 1156n, 40460n, 123456789n, generationBase(p.profile, 9)]) {
      let code: string;
      try {
        code = p.encode(id);
      } catch (e) {
        assert.ok(e instanceof BasehError && e.code === "BLOCKED_CODE");
        continue;
      }
      assert.equal(p.decode(code).id, id);
    }
  });

  it("honours custom rounds", () => {
    const p4 = new Baseh(basehExpandablePV1({ keyBytes: TEST_KEY, keyId: "test-01", rounds: 4 }));
    const p8 = new Baseh(basehExpandablePV1({ keyBytes: TEST_KEY, keyId: "test-01", rounds: 8 }));
    const c4 = p4.encode(42n);
    assert.equal(p4.decode(c4).id, 42n);
    assert.notEqual(c4, p8.encode(42n));
  });

  it("the keyed variant differs from the frozen-key tier", () => {
    const frozen = new Baseh(basehExpandableV1());
    const keyed = new Baseh(basehExpandablePV1({ keyBytes: TEST_KEY, keyId: "test-01" }));
    assert.notEqual(frozen.encode(42n), keyed.encode(42n));
  });
});

describe("expandable: mixed-mode interop (spec 20.7)", () => {
  it("explicit mode fixed behaves identically to an omitted mode", () => {
    const explicit = new Baseh({ ...basehMediumV1(), mode: "fixed" as const });
    const implicit = new Baseh(basehMediumV1());
    for (const id of [0n, 1n, 813n, 123456789n, 481890303n]) {
      let e: string | null = null;
      let i: string | null = null;
      try { e = explicit.encode(id); } catch { /* blocked */ }
      try { i = implicit.encode(id); } catch { /* blocked */ }
      assert.equal(e, i);
      if (e !== null) assert.equal(explicit.decode(e).id, implicit.decode(e).id);
    }
  });

  it("a 4-character code presented to a fixed tier fails exactly as before", () => {
    const fixed = new Baseh(basehMediumV1());
    const result = fixed.validate("ABCD");
    assert.equal(result.valid, false);
    assert.equal(result.reason, "INVALID_CHECKSUM"); // re-padded per spec 3.4
  });

  it("expandable profiles with no mode declared default at the helper, not by input sniffing", () => {
    // The decoder must not guess mode from input: an expandable profile
    // rejects a fixed-tier 8-symbol code on the checksum, per spec 19.7.
    const fixed = new Baseh(basehMediumV1());
    const expandable = new Baseh(basehExpandableV1());
    const fixedCode = fixed.encode(123456789n);
    const result = expandable.validate(fixedCode);
    assert.equal(result.valid, false);
  });

  it("grouping validation: grouping must be empty in expandable mode, fixed still requires the sum", () => {
    // The frozen expandable tier ships an empty grouping and must validate.
    assert.doesNotThrow(() => new Baseh(basehExpandableV1()));
    // Spec 19.5: the split is a pure function of total length, so any
    // configured grouping is rejected in expandable mode.
    expectError(
      () => new Baseh({ ...basehExpandableV1(), grouping: [4, 4] }),
      "INVALID_PROFILE"
    );
    expectError(
      () => new Baseh({ ...basehMediumV1(), grouping: [3, 3] }),
      "INVALID_PROFILE"
    );
    // separatorMinLength is expandable-only
    expectError(
      () => new Baseh({ ...basehMediumV1(), separatorMinLength: 6 }),
      "INVALID_PROFILE"
    );
    // minLength must exceed checksumLength
    expectError(
      () => new Baseh(customExpandable({ minLength: 1 })),
      "INVALID_PROFILE"
    );
  });
});
