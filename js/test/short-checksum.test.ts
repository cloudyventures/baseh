import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Baseh, BasehError,
  basehExpandableV1, basehExpandablePV1, basehMediumV1,
  generationBase, generationCapacity, effectiveChecksumLength,
  calculateChecksum
} from "../src/index.js";
import type { BasehProfile } from "../src/index.js";

const TEST_KEY = new TextEncoder().encode("test-only-key-material-0001");

function raw(code: string): string {
  return code.replaceAll("-", "");
}

function expectError(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => e instanceof BasehError && e.code === code);
}

/** Find the first issuable id at or after `from`. */
function firstIssuable(h: Baseh, from: bigint): bigint {
  for (let id = from; id < from + 10000n; id += 1n) {
    try {
      h.encode(id);
      return id;
    } catch {
      continue;
    }
  }
  throw new Error(`no issuable id from ${from}`);
}

describe("short checksum: frozen tier shape (spec 22.5)", () => {
  const h = new Baseh(basehExpandableV1());

  it("ships the feature on with checksumLength 2, short 1 through length 5", () => {
    assert.equal(h.profile.checksumLength, 2);
    assert.equal(h.profile.shortChecksumLength, 1);
    assert.equal(h.profile.shortChecksumUntil, 5);
    const p = new Baseh(basehExpandablePV1({ keyBytes: TEST_KEY, keyId: "test-01" }));
    assert.equal(p.profile.shortChecksumLength, 1);
    assert.equal(p.profile.shortChecksumUntil, 5);
  });

  it("resolves the effective checksum length per generation", () => {
    assert.equal(effectiveChecksumLength(h.profile, 4), 1);
    assert.equal(effectiveChecksumLength(h.profile, 5), 1);
    assert.equal(effectiveChecksumLength(h.profile, 6), 2);
    assert.equal(effectiveChecksumLength(h.profile, 8), 2);
  });

  it("generation capacities follow the effective K (spec 22.3)", () => {
    assert.equal(generationCapacity(h.profile, 4), 19683n); // 27^3
    assert.equal(generationCapacity(h.profile, 5), 531441n); // 27^4
    assert.equal(generationCapacity(h.profile, 6), 531441n); // one symbol buys the second checksum
    assert.equal(generationCapacity(h.profile, 7), 14348907n); // 27^5
    assert.equal(generationCapacity(h.profile, 8), 387420489n); // 27^6
  });
});

describe("short checksum: round trips and boundaries (spec 22.6)", () => {
  const h = new Baseh(basehExpandableV1());

  it("round trips the first and last issuable id of generations 4 through 8", () => {
    for (let l = 4; l <= 8; l += 1) {
      const first = firstIssuable(h, generationBase(h.profile, l));
      const last = generationBase(h.profile, l + 1) - 1n;
      for (const id of [first, last]) {
        let code: string;
        try {
          code = h.encode(id);
        } catch (e) {
          assert.ok(e instanceof BasehError && e.code === "BLOCKED_CODE", `id ${id} blocked`);
          continue;
        }
        assert.equal(raw(code).length, l);
        const d = h.decode(code);
        assert.equal(d.id, id);
        assert.equal(d.canonicalCode, code);
      }
    }
  });

  it("pins the short/normal boundary: last gen-5 id and first gen-6 id", () => {
    const lastShort = generationBase(h.profile, 6) - 1n; // 1,375,639
    const firstNormal = generationBase(h.profile, 6); // 1,375,640
    const a = raw(h.encode(lastShort));
    assert.equal(a.length, 5);
    assert.equal(a.length - 1, 4); // 1 checksum symbol at length 5
    assert.equal(h.decode(a).id, lastShort);
    const b = raw(h.encode(firstNormal));
    assert.equal(b.length, 6);
    assert.equal(b.length - 2, 4); // 2 checksum symbols at length 6
    assert.equal(h.decode(b).id, firstNormal);
  });

  it("a 4-character code validates against exactly 1 checksum symbol, never 2", () => {
    const id = firstIssuable(h, 0n);
    const code = raw(h.encode(id));
    assert.equal(code.length, 4);
    assert.equal(code.slice(3), calculateChecksum(h.profile, code.slice(0, 3), 1));
    // Flipping the single checksum symbol fails.
    const check = code[3] as string;
    const bad = check === "0" ? "1" : "0";
    expectError(() => h.decode(code.slice(0, 3) + bad), "INVALID_CHECKSUM");
    // Appending a second checksum symbol changes the generation; the split
    // moves and the code fails (spec 19.7), it never validates as gen 4 + 2.
    expectError(() => h.decode(code + check), "INVALID_CHECKSUM");
  });

  it("checksum values at short generations use modulus 35, not 1225", () => {
    const id = firstIssuable(h, 0n);
    const body = raw(h.encode(id)).slice(0, 3);
    const short = calculateChecksum(h.profile, body, 1);
    const full = calculateChecksum(h.profile, body, 2);
    assert.equal(short.length, 1);
    assert.equal(full.length, 2);
    assert.equal(raw(h.encode(id)).slice(3), short);
  });

  it("the separator threshold is still a function of total length (spec 22.4)", () => {
    // Length 5 renders bare even though its body grew; length 6 splits.
    assert.ok(!h.encode(generationBase(h.profile, 5)).includes("-"));
    assert.match(h.encode(firstIssuable(h, generationBase(h.profile, 6))), /^...-...$/);
  });

  it("the repetition scan covers body plus the short checksum (spec 22.4)", () => {
    // A run of 4 that spans body and the single checksum symbol must be
    // blocked. The scan rule is profile-independent, so use a small
    // permutation-free profile where such a code is guaranteed and fast to
    // find, then confirm the filter blocks it.
    const shape: BasehProfile = {
      profileId: "short-rep-test",
      mode: "expandable",
      bodyAlphabet: "AB",
      minLength: 4,
      checksumAlphabet: "0AB",
      checksumLength: 2,
      shortChecksumLength: 1,
      shortChecksumUntil: 5,
      caseSensitive: false,
      separator: "",
      separatorMinLength: 0,
      grouping: [],
      aliases: {},
      permutation: { enabled: false },
      profanity: { mode: "none" },
      maxRepetition: 0
    };
    const probe = new Baseh(shape);
    let found: bigint | null = null;
    for (let id = 0n; id < 2000n && found === null; id += 1n) {
      const r = raw(probe.encode(id));
      if (r.length >= 4 && new RegExp(`(.)\\1{3}$`).test(r)) found = id;
    }
    assert.ok(found !== null, "expected a code ending in a run of 4");
    const blocked = new Baseh({ ...shape, maxRepetition: 4 });
    expectError(() => blocked.encode(found), "BLOCKED_CODE");
  });
});

describe("short checksum: validation (spec 22.2)", () => {
  const base = basehExpandableV1();

  it("rejects the fields in fixed mode", () => {
    expectError(
      () => new Baseh({ ...basehMediumV1(), shortChecksumLength: 1, shortChecksumUntil: 5 }),
      "INVALID_PROFILE"
    );
    expectError(
      () => new Baseh({ ...basehMediumV1(), shortChecksumUntil: 5 }),
      "INVALID_PROFILE"
    );
  });

  it("rejects shortChecksumLength >= checksumLength", () => {
    expectError(
      () => new Baseh({ ...base, shortChecksumLength: 2, shortChecksumUntil: 5 }),
      "INVALID_PROFILE"
    );
    expectError(
      () => new Baseh({ ...base, shortChecksumLength: 3, shortChecksumUntil: 5 }),
      "INVALID_PROFILE"
    );
  });

  it("rejects shortChecksumUntil below minLength", () => {
    expectError(
      () => new Baseh({ ...base, shortChecksumLength: 1, shortChecksumUntil: 3 }),
      "INVALID_PROFILE"
    );
  });

  it("rejects minLength <= shortChecksumLength", () => {
    expectError(
      () => new Baseh({ ...base, minLength: 1, shortChecksumLength: 1, shortChecksumUntil: 5 }),
      "INVALID_PROFILE"
    );
  });

  it("rejects shortChecksumUntil without shortChecksumLength... no longer: until alone is a legal zero-checksum window", () => {
    // Spec 22 amendment: the window field is the switch, so until + absent
    // length (defaults to 0) is the zero-checksum window, not an error.
    const h = new Baseh({ ...base, shortChecksumLength: 0, shortChecksumUntil: 5 });
    assert.equal(h.profile.shortChecksumLength, 0);
    assert.equal(effectiveChecksumLength(h.profile, 4), 0);
  });

  it("rejects shortChecksumLength without shortChecksumUntil", () => {
    const plain = { ...base, shortChecksumLength: 0, shortChecksumUntil: 0 };
    expectError(() => new Baseh({ ...plain, shortChecksumLength: 1 }), "INVALID_PROFILE");
  });

  it("rejects shortChecksumUntil above 8", () => {
    expectError(
      () => new Baseh({ ...base, shortChecksumLength: 1, shortChecksumUntil: 9 }),
      "INVALID_PROFILE"
    );
  });

  it("accepts shortChecksumUntil of 8", () => {
    const h = new Baseh({ ...base, shortChecksumLength: 1, shortChecksumUntil: 8 });
    assert.equal(effectiveChecksumLength(h.profile, 8), 1);
    assert.equal(effectiveChecksumLength(h.profile, 9), 2);
  });

  it("rejects a non-integer shortChecksumLength", () => {
    expectError(
      () => new Baseh({ ...base, shortChecksumLength: 1.5, shortChecksumUntil: 5 }),
      "INVALID_PROFILE"
    );
  });

  it("0 or absent turns the feature off and keeps the old shape", () => {
    const off = new Baseh({ ...base, shortChecksumLength: 0, shortChecksumUntil: 0 });
    assert.equal(off.profile.shortChecksumLength, 0);
    assert.equal(generationCapacity(off.profile, 4), 729n); // 27^2
    assert.equal(effectiveChecksumLength(off.profile, 4), 2);
    const code = off.encode(100n);
    assert.equal(raw(code).length, 4);
    assert.equal(off.decode(code).id, 100n);
  });

  it("a custom short-checksum window round trips at every generation", () => {
    const profile: BasehProfile = {
      ...base,
      profileId: "short-window-test",
      minLength: 4,
      checksumLength: 2,
      shortChecksumLength: 1,
      shortChecksumUntil: 6,
      permutation: { enabled: false },
      profanity: { mode: "none" },
      maxRepetition: 0
    };
    const h = new Baseh(profile);
    // Body sizes: 3, 4, 5 through length 6 (K = 1), then L - 2.
    assert.equal(generationCapacity(h.profile, 4), 27n ** 3n);
    assert.equal(generationCapacity(h.profile, 6), 27n ** 5n);
    assert.equal(generationCapacity(h.profile, 7), 27n ** 5n); // K = 2 kicks in
    assert.ok(generationCapacity(h.profile, 6) > generationCapacity(h.profile, 5));
    for (let l = 4; l <= 8; l += 1) {
      const id = generationBase(h.profile, l) + 7n;
      const code = h.encode(id);
      assert.equal(raw(code).length, l);
      assert.equal(h.decode(code).id, id);
    }
  });
});

describe("short checksum: zero-checksum window (spec 22 amendment)", () => {
  const base = basehExpandableV1();
  const zeroProfile: BasehProfile = {
    ...base,
    profileId: "short-zero-test",
    minLength: 4,
    checksumLength: 2,
    shortChecksumLength: 0,
    shortChecksumUntil: 5,
    permutation: { enabled: false },
    profanity: { mode: "none" },
    maxRepetition: 0
  };
  const h = new Baseh(zeroProfile);

  it("resolves effective K of 0 inside the window, checksumLength above it", () => {
    assert.equal(effectiveChecksumLength(h.profile, 4), 0);
    assert.equal(effectiveChecksumLength(h.profile, 5), 0);
    assert.equal(effectiveChecksumLength(h.profile, 6), 2);
  });

  it("window generations are all body: capacity is A^L", () => {
    assert.equal(generationCapacity(h.profile, 4), 27n ** 4n);
    assert.equal(generationCapacity(h.profile, 5), 27n ** 5n);
    assert.equal(generationCapacity(h.profile, 6), 27n ** 4n); // K = 2 above the window
  });

  it("round trips generations 4 through 6 with no checksum symbols in the window", () => {
    for (let l = 4; l <= 6; l += 1) {
      for (const id of [generationBase(h.profile, l), generationBase(h.profile, l + 1) - 1n]) {
        const code = h.encode(id);
        assert.equal(raw(code).length, l);
        if (l <= 5) assert.equal(raw(code), raw(code).slice(0, l)); // all body
        assert.equal(h.decode(code).id, id);
        assert.equal(h.decode(code).canonicalCode, code);
      }
    }
  });

  it("the checksum of zero symbols is the empty string", () => {
    const id = generationBase(h.profile, 4);
    const code = raw(h.encode(id));
    assert.equal(code.length, 4);
    assert.equal(calculateChecksum(h.profile, code, 0), "");
  });

  it("a typo at a zero-checksum generation is NOT detected (documented trade-off)", () => {
    const id = generationBase(h.profile, 4) + 1n;
    const code = raw(h.encode(id));
    // Flip the last body symbol to a different body symbol.
    const last = code[3] as string;
    const replacement = last === "1" ? "2" : "1";
    const typed = code.slice(0, 3) + replacement;
    const d = h.decode(typed); // no error: there is no checksum to fail
    assert.notEqual(d.id, id);
  });

  it("correction at a zero-checksum generation behaves like a no-checksum fixed profile", () => {
    // With no checksum there is nothing to correct against: any body
    // decodes as-is and tryCorrection never engages.
    const id = generationBase(h.profile, 5) + 3n;
    const code = raw(h.encode(id));
    const d = h.decode(code, { tryCorrection: true, confusionProfile: "heavy" });
    assert.equal(d.id, id);
    assert.equal(d.corrected, false);
    const last = code[4] as string;
    const typed = code.slice(0, 4) + (last === "1" ? "2" : "1");
    const d2 = h.decode(typed, { tryCorrection: true, confusionProfile: "heavy" });
    assert.notEqual(d2.id, id);
    assert.equal(d2.corrected, false);
  });

  it("the repetition scan covers the whole all-body code (spec 22.4)", () => {
    const filtered = new Baseh({ ...zeroProfile, maxRepetition: 4 });
    let found: bigint | null = null;
    for (let id = 0n; id < generationCapacity(h.profile, 4); id += 1n) {
      const r = raw(h.encode(id));
      if (new RegExp(`(.)\\1{3}`).test(r)) {
        found = id;
        break;
      }
    }
    assert.ok(found !== null, "expected a gen-4 code with a run of 4");
    expectError(() => filtered.encode(found), "BLOCKED_CODE");
  });
});

describe("short checksum: until-8 window boundary", () => {
  const base = basehExpandableV1();
  const h = new Baseh({
    ...base,
    profileId: "short-until-8-test",
    minLength: 4,
    checksumLength: 2,
    shortChecksumLength: 1,
    shortChecksumUntil: 8,
    permutation: { enabled: false },
    profanity: { mode: "none" },
    maxRepetition: 0
  });

  it("generation 8 carries one checksum symbol, generation 9 carries two", () => {
    const id8 = generationBase(h.profile, 8) + 5n;
    const c8 = raw(h.encode(id8));
    assert.equal(c8.length, 8);
    assert.equal(c8.slice(7), calculateChecksum(h.profile, c8.slice(0, 7), 1));
    assert.equal(h.decode(c8).id, id8);
    const id9 = generationBase(h.profile, 9) + 5n;
    const c9 = raw(h.encode(id9));
    assert.equal(c9.length, 9);
    assert.equal(c9.slice(7), calculateChecksum(h.profile, c9.slice(0, 7), 2));
    assert.equal(h.decode(c9).id, id9);
  });
});
