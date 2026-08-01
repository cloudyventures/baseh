import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculate, design, minimumLength, parseRequired, powBigInt, sampleCodes, type CalculatorInput, type DesignerInput } from "../src/core.js";

function calcInput(overrides: Partial<CalculatorInput> = {}): CalculatorInput {
  return {
    namespace: "",
    codecMode: "fixed",
    alphabetMode: "alnum",
    customAlphabet: "",
    visualSafety: "none",
    spokenSafety: "none",
    profanity: "none",
    bodyLength: 6,
    minLength: 4,
    separatorMinLength: 6,
    checksumLength: 1,
    permutation: false,
    separator: "-",
    prefix: "",
    suffix: "",
    peakMultiplier: 1.25,
    safetyMargin: 2.0,
    ...overrides
  };
}

function designInput(overrides: Partial<DesignerInput> = {}): DesignerInput {
  return {
    requiredCapacity: 60_000_000n,
    peakMultiplier: 1.25,
    safetyMargin: 2.0,
    maxDisplayedLength: 9,
    minimumChecksumLength: 1,
    maxUtilization: 0.5,
    separator: "",
    allowDigits: true,
    allowUpper: true,
    allowAlnum: true,
    visualSafety: "none",
    spokenSafety: "none",
    profanity: "none",
    permutation: false,
    ...overrides
  };
}

describe("capacity table (spec 14)", () => {
  const cases: Array<[number, number, string]> = [
    [10, 3, "1000"], [10, 6, "1000000"], [16, 5, "1048576"], [32, 5, "33554432"],
    [32, 6, "1073741824"], [36, 5, "60466176"], [36, 6, "2176782336"]
  ];
  for (const [base, len, expected] of cases) {
    it(`${base}^${len} = ${expected}`, () => {
      assert.equal(powBigInt(BigInt(base), len).toString(), expected);
    });
  }
});

describe("calculator", () => {
  it("checksum length never changes body capacity", () => {
    const a = calculate(calcInput({ visualSafety: "light", checksumLength: 1 }));
    const b = calculate(calcInput({ visualSafety: "light", checksumLength: 2 }));
    assert.equal(a.capacity, b.capacity);
    assert.equal(a.displayedCombinations * 26n, b.displayedCombinations);
  });
  it("presets load exact documented capacities", () => {
    const presets: Array<[Partial<CalculatorInput>, string]> = [
      [{ alphabetMode: "digits", visualSafety: "none", bodyLength: 6, checksumLength: 1 }, "1000000"],
      [{ alphabetMode: "alnum", visualSafety: "heavy", bodyLength: 6, checksumLength: 1 }, "1073741824"],
      [{ alphabetMode: "alnum", visualSafety: "heavy", bodyLength: 5, checksumLength: 1 }, "33554432"],
      [{ alphabetMode: "alnum", visualSafety: "heavy", bodyLength: 6, checksumLength: 2 }, "1073741824"]
    ];
    for (const [over, expected] of presets) {
      assert.equal(calculate(calcInput(over)).capacity.toString(), expected);
    }
  });
  it("flags separator colliding with alphabet", () => {
    const r = calculate(calcInput({ separator: "A" }));
    assert.ok(!r.valid);
  });
  it("required exceeds capacity is invalid status", () => {
    const r = calculate(calcInput({
      alphabetMode: "digits", bodyLength: 3, recordsPerDay: 10_000n, retentionDays: 365n
    }));
    assert.equal(r.utilizationStatus, "invalid");
  });
  it("examples are deterministic and valid", () => {
    const r = calculate(calcInput({ visualSafety: "light" }));
    assert.equal(r.examples.length, 5);
    for (const e of r.examples) assert.match(e.code, /^[0-9A-Z-]+$/);
  });
  it("permutation changes codes but not capacity, deterministically", () => {
    const off = calculate(calcInput());
    const on = calculate(calcInput({ permutation: true }));
    const onAgain = calculate(calcInput({ permutation: true }));
    assert.equal(on.capacity, off.capacity);
    assert.deepEqual(on.examples, onAgain.examples);
    assert.notDeepEqual(on.examples, off.examples);
    for (const e of on.examples) assert.match(e.code, /^[0-9A-Z-]+$/);
  });
});

describe("permutation previews (sampleCodes)", () => {
  it("permuted samples are stable and differ from unpermuted", () => {
    const plain = sampleCodes("0123456789ABCDEFGHJKMNPQRSTVWXYZ", 6, 1, 32n ** 6n);
    const permuted = sampleCodes("0123456789ABCDEFGHJKMNPQRSTVWXYZ", 6, 1, 32n ** 6n,
      "none", "", "none", true);
    assert.equal(plain.length, permuted.length);
    assert.notDeepEqual(plain, permuted);
    assert.deepEqual(permuted, sampleCodes("0123456789ABCDEFGHJKMNPQRSTVWXYZ", 6, 1, 32n ** 6n,
      "none", "", "none", true));
  });
});

describe("designer (spec 15)", () => {
  it("required 33554432, base32 -> length 5", () => {
    assert.equal(minimumLength(32, 33_554_432n), 5);
  });
  it("required 33554433, base32 -> length 6", () => {
    assert.equal(minimumLength(32, 33_554_433n), 6);
  });
  it("required 1073741824 -> 6, 1073741825 -> 7", () => {
    assert.equal(minimumLength(32, 1_073_741_824n), 6);
    assert.equal(minimumLength(32, 1_073_741_825n), 7);
  });
  it("recommendation respects minimum checksum and max utilization", () => {
    const r = design(designInput({ requiredCapacity: 60_000_000n }));
    assert.ok(r.recommended);
    assert.ok(r.recommended!.checksumLength >= 1);
    assert.ok(r.recommended!.utilization <= 0.5);
  });
  it("max displayed length too short yields repair text", () => {
    const r = design(designInput({ requiredCapacity: 60_000_000n, maxDisplayedLength: 5 }));
    assert.equal(r.recommended, null);
    assert.ok(r.repair && r.repair.includes("displayed length"));
  });
  it("hard alphabet restriction is respected", () => {
    const r = design(designInput({ allowAlnum: false, allowUpper: false }));
    for (const c of r.feasible) assert.equal(c.alphabetId, "digits10");
  });
  it("ordering is deterministic", () => {
    const a = design(designInput());
    const b = design(designInput());
    assert.deepEqual(a, b);
  });
});

describe("spoken safety (strip one of each pair)", async () => {
  const { deriveAlphabet, deriveChecksumAlphabet, spokenAliases } = await import("../src/core.js");

  it("light strips D and T from alnum and aliases them back", () => {
    const a = deriveAlphabet("alnum", "", "none", "light");
    assert.equal(a.includes("D"), false);
    assert.equal(a.includes("T"), false);
    assert.equal(a.includes("B"), true);
    assert.equal(a.includes("P"), true);
    assert.equal(a.length, 34);
    assert.deepEqual(spokenAliases(a, "light"), { D: "B", T: "P" });
  });
  it("heavy strips all six dropped letters", () => {
    const a = deriveAlphabet("alnum", "", "none", "heavy");
    for (const c of "DTNWSG") assert.equal(a.includes(c), false);
    assert.equal(a.length, 30);
  });
  it("a pair is skipped when the kept symbol is absent", () => {
    const a = deriveAlphabet("digits", "", "none", "heavy");
    assert.equal(a, "0123456789");
    assert.deepEqual(spokenAliases(a, "heavy"), {});
  });
  it("checksum alphabet drops the same symbols so aliases stay valid", () => {
    const body = deriveAlphabet("alnum", "", "none", "light");
    const check = deriveChecksumAlphabet(body, "light");
    assert.equal(check.includes("D"), false);
    assert.equal(check.includes("T"), false);
  });
  it("spoken light lowers alnum capacity", () => {
    const plain = calculate(calcInput());
    const spoken = calculate(calcInput({ spokenSafety: "light" }));
    assert.ok(spoken.capacity < plain.capacity);
    assert.equal(spoken.capacity.toString(), "1544804416");
  });
  it("designer reflects the spoken level in candidate alphabets", () => {
    const r = design(designInput({ requiredCapacity: 1_000_000n, spokenSafety: "medium" }));
    assert.ok(r.feasible.every((c) => c.spoken === "medium"));
    const alnum = r.feasible.find((c) => c.alphabetId.startsWith("alnum"));
    assert.ok(alnum && !alnum.alphabet.includes("N"));
  });
  it("example codes for a spoken-light profile contain no stripped symbols", () => {
    const r = calculate(calcInput({ spokenSafety: "heavy", checksumLength: 2 }));
    for (const ex of r.examples) {
      assert.doesNotMatch(ex.code.slice(0, 6), /[DTNWSG]/);
    }
  });
});

describe("separator in the designer", () => {
  it("adds one displayed char per delimiter position", () => {
    const plain = design(designInput({ requiredCapacity: 1_000_000n, separator: "" }));
    const dashed = design(designInput({ requiredCapacity: 1_000_000n, separator: "-" }));
    const p = plain.feasible[0]!;
    const d = dashed.feasible.find((c) => c.alphabetId === p.alphabetId && c.bodyLength === p.bodyLength && c.checksumLength === p.checksumLength)!;
    assert.equal(d.displayedLength, p.displayedLength + (p.bodyLength + p.checksumLength > 4 ? 1 : 0));
  });
  it("sample codes carry the delimiter", async () => {
    const { sampleCodes } = await import("../src/core.js");
    const s = sampleCodes("0123456789ABCDEFGHJKMNPQRSTVWXYZ", 6, 1, 1073741824n, "none", "-");
    assert.ok(s.length > 0 && s.every((e) => e.code.includes("-")));
  });
  it("empty delimiter means none", async () => {
    const { sampleCodes } = await import("../src/core.js");
    const s = sampleCodes("0123456789ABCDEFGHJKMNPQRSTVWXYZ", 6, 1, 1073741824n, "none", "");
    assert.ok(s.length > 0 && s.every((e) => !e.code.includes("-")));
  });
});

describe("example codes for letters-only alphabets", async () => {
  const { deriveAlphabet, sampleCodes } = await import("../src/core.js");
  it("produce codes without digit-target aliases", () => {
    // Mirror the designer flow: the alphabet arrives already derived
    // (visual + spoken strips applied) rather than raw.
    const alpha = deriveAlphabet("upper", "", "light", "light");
    const s = sampleCodes(alpha, 6, 1, BigInt(alpha.length) ** 6n, "light");
    assert.ok(s.length === 3);
    assert.equal(s[0]!.id, "0");
  });
});

describe("parseRequired", () => {
  it("parses plain digits and grouped digits", () => {
    assert.equal(parseRequired("60000000"), 60000000n);
    assert.equal(parseRequired("60,000,000"), 60000000n);
    assert.equal(parseRequired("60_000_000"), 60000000n);
    assert.equal(parseRequired("1"), 1n);
  });
  it("parses k m b t suffixes, case-insensitive", () => {
    assert.equal(parseRequired("6k"), 6000n);
    assert.equal(parseRequired("6K"), 6000n);
    assert.equal(parseRequired("6m"), 6000000n);
    assert.equal(parseRequired("6M"), 6000000n);
    assert.equal(parseRequired("6b"), 6000000000n);
    assert.equal(parseRequired("6t"), 6000000000000n);
  });
  it("parses decimal suffixes without changing the number", () => {
    assert.equal(parseRequired("2.5m"), 2500000n);
    assert.equal(parseRequired("1.5B"), 1500000000n);
    assert.equal(parseRequired("0.4k"), 400n);
  });
  it("rounds sub-integer results half up", () => {
    assert.equal(parseRequired("1.2345k"), 1235n);
  });
  it("rejects junk and zero", () => {
    assert.equal(parseRequired(""), null);
    assert.equal(parseRequired("0"), null);
    assert.equal(parseRequired("abc"), null);
    assert.equal(parseRequired("6x"), null);
    assert.equal(parseRequired("-5"), null);
    assert.equal(parseRequired("6.5.2m"), null);
  });
});

describe("profanity modes (spec 18)", async () => {
  const { deriveAlphabet, deriveChecksumAlphabet, sampleCodes } = await import("../src/core.js");

  it("no-vowels strips AEIOU from body and checksum alphabets", () => {
    const body = deriveAlphabet("alnum", "", "none", "none", "no-vowels");
    for (const c of "AEIOU") assert.equal(body.includes(c), false);
    const check = deriveChecksumAlphabet(body, "none", "no-vowels");
    for (const c of "AEIOU") assert.equal(check.includes(c), false);
  });
  it("no-vowels lowers alnum capacity to 31^6", () => {
    const r = calculate(calcInput({ profanity: "no-vowels" }));
    assert.equal(r.capacity.toString(), "887503681");
  });
  it("designer prices no-vowels into candidate alphabets", () => {
    const r = design(designInput({ profanity: "no-vowels" }));
    for (const c of r.feasible) {
      if (c.alphabetId !== "digits10") assert.equal(c.alphabet.includes("A"), false);
    }
  });
  it("blocklist keeps the alphabet but sample profile accepts the mode", () => {
    const alpha = deriveAlphabet("alnum", "", "light", "light", "blocklist");
    assert.equal(alpha.length, 31);
    const s = sampleCodes(alpha, 6, 1, BigInt(alpha.length) ** 6n, "light", "", "blocklist");
    assert.ok(s.length === 3);
    for (const sample of s) {
      if (sample.blocked) assert.equal(sample.code, "");
    }
  });
  it("a delimiter that collides with every alphabet yields a delimiter repair", () => {
    const r = design(designInput({ separator: "A", allowDigits: false }));
    assert.equal(r.recommended, null);
    assert.ok(r.repair && r.repair.includes('delimiter "A"'));
  });
});

describe("safety explainer lines", async () => {
  const { deriveAlphabet, visualDropsExplainer, spokenDropsExplainer } = await import("../src/core.js");

  it("visual medium names every dropped symbol and its typed alias", () => {
    const before = deriveAlphabet("alnum", "", "none", "none");
    const after = deriveAlphabet("alnum", "", "medium", "none");
    assert.equal(visualDropsExplainer(before, after, "medium"),
      "Removes from the alphabet: B (read as 8), I (read as 1), L (read as 1), O (read as 0), S (read as 5).");
  });
  it("visual heavy describes the restriction and notes B, S and W remain", () => {
    const before = deriveAlphabet("alnum", "", "none", "none");
    const after = deriveAlphabet("alnum", "", "heavy", "none");
    const text = visualDropsExplainer(before, after, "heavy");
    assert.ok(text.startsWith("Restricts to the reviewed 32-symbol alphabet"));
    for (const frag of ["I (read as 1)", "L (read as 1)", "O (read as 0)", "U (read as V)", "B, S and W remain"]) {
      assert.ok(text.includes(frag), `missing ${frag}`);
    }
  });
  it("visual light on a digits alphabet reports nothing to drop", () => {
    const before = deriveAlphabet("digits", "", "none", "none");
    const after = deriveAlphabet("digits", "", "medium", "none");
    assert.equal(visualDropsExplainer(before, after, "medium"), "No visual drops apply with the current alphabet.");
  });
  it("spoken medium names D, T, N and W", () => {
    const pre = deriveAlphabet("alnum", "", "medium", "none");
    assert.equal(spokenDropsExplainer(pre, "medium"),
      "Removes from the alphabet: T (read as P), N (read as M), W (read as V).");
  });
  it("spoken none stays blank and digits-only reports no applicable pairs", () => {
    assert.equal(spokenDropsExplainer("0123456789", "none"), "");
    assert.equal(spokenDropsExplainer("0123456789", "heavy"), "No spoken drops apply with the current safety settings.");
  });
});

describe("trySuggestions", async () => {
  const { calculatorProfile, trySuggestions } = await import("../src/core.js");
  const { Baseh } = await import("@cloudyventures/baseh");

  function mediumProfile() {
    return calculatorProfile(calcInput({ visualSafety: "medium", spokenSafety: "medium", checksumLength: 2 }))!;
  }

  it("opens with a substitutions summary of every admitted alias", () => {
    const items = trySuggestions(mediumProfile(), "C8XP-8J49");
    assert.ok(items[0]!.label.startsWith("substitutions: "));
    for (const frag of ["O for 0", "I for 1", "L for 1", "B for 8", "S for 5", "T for P", "N for M", "W for V"]) {
      assert.ok(items[0]!.label.includes(frag), `missing ${frag}`);
    }
    assert.equal(items[0]!.code, undefined);
  });
  it("offers case, delimiter, space and checksum probes of the compact shape", () => {
    const profile = mediumProfile();
    const h = new Baseh(profile);
    const code = h.encode(123456789n);
    const items = trySuggestions(profile, code);
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("change case"));
    assert.ok(labels.includes("remove the delimiters"));
    assert.ok(labels.includes("add a delimiter"));
    assert.ok(labels.includes("add spaces"));
    assert.ok(labels.includes("change the last character (breaks the checksum)"));
    assert.ok(!labels.some((l) => l.startsWith("mistype")), "no correction demo on alias-absorbing profiles");
  });
  it("category chips decode or fail as labelled", () => {
    const profile = mediumProfile();
    const h = new Baseh(profile);
    const code = h.encode(123456789n);
    const items = trySuggestions(profile, code);
    for (const label of ["change case", "remove the delimiters", "add a delimiter", "add spaces"]) {
      const c = items.find((i) => i.label === label)!.code!;
      assert.equal(h.decode(c.replace(/\s+/g, "")).id, 123456789n, label);
    }
    const broken = items.find((i) => i.label.startsWith("change the last character"))!.code!;
    assert.throws(() => h.decode(broken), (e: unknown) => {
      const be = e as { code?: string };
      return e instanceof Error && be.code === "INVALID_CHECKSUM";
    });
  });
  it("a profile keeping both partners of a sound-alike pair gets verified correction demos", () => {
    const profile = calculatorProfile(calcInput({ visualSafety: "none", spokenSafety: "none", checksumLength: 2 }))!;
    const h = new Baseh(profile);
    // 123456791 encodes to 21I3-VBRJ, whose body holds two letters whose
    // sound-alike partner is dropped: V (from the V, W pair) and B (from B, D).
    const code = h.encode(123456791n);
    const items = trySuggestions(profile, code, h);
    const demos = items.filter((i) => i.label.startsWith("mistype"));
    assert.ok(demos.length >= 2, "expected several correction demos");
    for (const demo of demos) {
      const decoded = h.decode(demo.code!, { tryCorrection: true, confusionProfile: "heavy" });
      assert.equal(decoded.corrected, true, demo.code);
      assert.equal(decoded.id, 123456791n);
      assert.equal(decoded.canonicalCode, code);
    }
  });
  it("with codec omitted the correction demos are simply not offered", () => {
    const profile = calculatorProfile(calcInput({ visualSafety: "none", spokenSafety: "none", checksumLength: 2 }))!;
    const items = trySuggestions(profile, "ABCDEFGH");
    assert.ok(!items.some((i) => i.label.startsWith("mistype")));
  });
  it("a zero-checksum profile warns that typos silently decode", () => {
    const items = trySuggestions(calculatorProfile(calcInput({ checksumLength: 0 }))!, "ABCDEF");
    assert.ok(items.some((i) => i.label.includes("silently decodes") && !i.code));
    assert.ok(!items.some((i) => i.label.startsWith("change the last character")));
  });
  it("without a sample only the substitutions summary remains", () => {
    const items = trySuggestions(mediumProfile(), null);
    assert.deepEqual(items.map((i) => i.label.startsWith("substitutions: ")), [true]);
  });
});

describe("expandable derivation (spec 19.2/19.3)", async () => {
  const { deriveExpandableBodyAlphabet, deriveExpandableChecksumAlphabet } = await import("../src/core.js");

  it("strips 0 and O from the alphanumeric derivation", () => {
    const body = deriveExpandableBodyAlphabet("alnum", "", "none");
    assert.equal(body, "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ");
    assert.equal(body.length, 34);
  });
  it("strips 0 from digits and from custom alphabets", () => {
    assert.equal(deriveExpandableBodyAlphabet("digits", "", "none"), "123456789");
    assert.equal(deriveExpandableBodyAlphabet("custom", "0O1aB", "none"), "1AB");
  });
  it("composes on top of visual, spoken and profanity derivations", () => {
    // Heavy's 32-symbol set keeps 0 but not O; the zero ban removes the 0.
    const heavy = deriveExpandableBodyAlphabet("alnum", "", "heavy");
    assert.equal(heavy.length, 31);
    assert.ok(!heavy.includes("0") && !heavy.includes("O"));
    // no-vowels also strips, and the ban still applies after it.
    const nv = deriveExpandableBodyAlphabet("custom", "AEIOU0123", "none", "none", "no-vowels");
    assert.equal(nv, "123");
  });
  it("checksum alphabet is 0 followed by the body", () => {
    const body = deriveExpandableBodyAlphabet("alnum", "", "none");
    assert.equal(deriveExpandableChecksumAlphabet(body), "0" + body);
    assert.equal(deriveExpandableChecksumAlphabet(body).length, 35);
  });
});

describe("expandable generation arithmetic (spec 19.1/19.6)", async () => {
  const { generationTable, generationForDemand, generationCumulative } = await import("../src/core.js");

  // The spec 17.1 table for the 34-symbol alphabet, checksum length 2, minLength 4.
  it("matches the frozen tier's generation table", () => {
    const rows = generationTable(34, 2, 4, 5);
    const expected: Array<[number, string, string]> = [
      [4, "1156", "1156"],
      [5, "39304", "40460"],
      [6, "1336336", "1376796"],
      [7, "45435424", "46812220"],
      [8, "1544804416", "1591616636"]
    ];
    for (let i = 0; i < expected.length; i += 1) {
      assert.equal(rows[i]!.length, expected[i]![0]);
      assert.equal(rows[i]!.capacity.toString(), expected[i]![1]);
      assert.equal(rows[i]!.cumulative.toString(), expected[i]![2]);
    }
  });
  it("cumulative equals the sum of the generation capacities", () => {
    assert.equal(generationCumulative(34, 2, 4, 6).toString(), "1376796");
  });
  it("generationForDemand lands on the boundary generations", () => {
    assert.equal(generationForDemand(34, 2, 4, 0n), 4);
    assert.equal(generationForDemand(34, 2, 4, 1155n), 4);
    assert.equal(generationForDemand(34, 2, 4, 1156n), 5);
    assert.equal(generationForDemand(34, 2, 4, 40460n), 6);
  });
});

describe("expandable separator shape (spec 19.5)", async () => {
  const { expandableDisplayedLength, expandableGrouping } = await import("../src/core.js");

  it("is bare below separatorMinLength and hyphenated from it up", () => {
    assert.equal(expandableDisplayedLength(4, "-", 6), 4);
    assert.equal(expandableDisplayedLength(5, "-", 6), 5);
    assert.equal(expandableDisplayedLength(6, "-", 6), 7);
    assert.equal(expandableDisplayedLength(8, "-", 6), 9);
  });
  it("with no separator the length is the raw length", () => {
    assert.equal(expandableDisplayedLength(9, "", 6), 9);
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
  it("rendered codes carry the balanced shapes", async () => {
    const { Baseh, basehExpandableV1, generationBase } = await import("@cloudyventures/baseh");
    const h = new Baseh(basehExpandableV1());
    // Bare 4 and 5 below the tier's separatorMinLength of 6; from 6 up the
    // balanced split shows: 6 XXX-XXX, 7 XXXX-XXX, 9 XXXXX-XXXX, 10 XXXXX-XXXXX.
    const shapes: Record<number, RegExp> = {
      4: /^....$/,
      5: /^.....$/,
      6: /^...-...$/,
      7: /^....-...$/,
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
  it("a non-empty grouping makes an expandable profile invalid", async () => {
    const { Baseh, BasehError, basehExpandableV1 } = await import("@cloudyventures/baseh");
    assert.throws(
      () => new Baseh({ ...basehExpandableV1(), grouping: [4, 4] }),
      (e: unknown) => e instanceof BasehError && e.code === "INVALID_PROFILE"
    );
  });
});

describe("expandable calculator mode", async () => {
  const { calculate, calculatorProfile } = await import("../src/core.js");
  const { Baseh } = await import("@cloudyventures/baseh");

  const exp = (overrides: Partial<CalculatorInput> = {}) => calcInput({
    codecMode: "expandable", visualSafety: "none", checksumLength: 2, separator: "-", ...overrides
  });

  it("reports a generation table instead of a single capacity", () => {
    const r = calculate(exp());
    assert.ok(r.valid);
    assert.ok(r.generations);
    assert.equal(r.generations![0]!.capacity.toString(), "1156");
    assert.equal(r.maxId, null);
    assert.equal(r.displayedLength, 4);
  });
  it("validates minLength against the checksum length", () => {
    assert.ok(!calculate(exp({ minLength: 2 })).valid);
    assert.ok(!calculate(exp({ minLength: 0 })).valid);
    assert.ok(!calculate(exp({ separatorMinLength: -1 })).valid);
  });
  it("demand analysis names the generation the demand lands in", () => {
    // 1000/day x 3650 days x 1.25 x 2 = 9,125,000 required: generation 7.
    const r = calculate(exp({ recordsPerDay: 1000n, retentionDays: 3650n }));
    assert.equal(r.requiredGeneration, 7);
    assert.equal(r.utilizationStatus, "green");
    assert.ok(r.lifetimeDays !== null && r.lifetimeDays > 0n);
  });
  it("examples cross the growth boundaries with real round trips", () => {
    const r = calculate(exp({ permutation: false }));
    const h = new Baseh(calculatorProfile(exp({ permutation: false }))!);
    assert.equal(r.examples.length, 5);
    // id 0 and the last of generation 4 are 4 chars bare; the first of
    // generation 5 is 5; the first of generation 6 carries the hyphen.
    const byId = new Map(r.examples.filter((e) => !e.blocked).map((e) => [e.id, e.code]));
    assert.equal(byId.get("0")!.length, 4);
    assert.ok(!byId.get("0")!.includes("-"));
    assert.equal(byId.get("1155")!.length, 4);
    assert.equal(byId.get("1156")!.length, 5);
    assert.equal(byId.get("40460")!.length, 7);
    assert.ok(byId.get("40460")!.includes("-"));
    for (const e of r.examples) {
      if (e.blocked) continue;
      assert.equal(h.decode(e.code).id, BigInt(e.id));
      const raw = e.code.replaceAll("-", "");
      assert.ok(!raw.includes("O"), e.code);
      assert.ok(!raw.slice(0, raw.length - 2).includes("0"), e.code);
    }
  });
  it("expandable preview codes never contain 0 or O in body positions, even from custom alphabets", () => {
    const r = calculate(exp({ alphabetMode: "custom", customAlphabet: "0123456789O", checksumLength: 1, minLength: 3 }));
    assert.ok(r.valid);
    for (const e of r.examples) {
      if (e.blocked) continue;
      const raw = e.code.replaceAll("-", "");
      assert.ok(!raw.includes("O"), e.code);
      // The checksum alphabet legitimately contains 0; the body never does.
      assert.ok(!raw.slice(0, raw.length - 1).includes("0"), e.code);
    }
  });
  it("typed O still decodes through the alias to the checksum-only 0", () => {
    const r = calculate(exp({ permutation: false }));
    const h = new Baseh(calculatorProfile(exp({ permutation: false }))!);
    const sample = r.examples.find((e) => !e.blocked && e.code.includes("0"));
    if (sample) {
      assert.equal(h.decode(sample.code.replace("0", "O")).id, BigInt(sample.id));
    }
  });
  it("capacity() stays fixed-only: the expandable preview has no single capacity", () => {
    const h = new Baseh(calculatorProfile(exp())!);
    assert.throws(() => h.capacity());
  });
});

describe("expandable designer outcome", async () => {
  const { expandableDesign } = await import("../src/core.js");

  it("derives the frozen-tier shape on the best allowed alphabet", () => {
    const d = expandableDesign(designInput({ requiredCapacity: 60_000_000n }))!;
    assert.equal(d.bodyAlphabet.length, 34);
    assert.equal(d.minLength, 4);
    assert.equal(d.separatorMinLength, 6);
    assert.equal(d.startCapacity.toString(), "1156");
    // 60M ids land in generation 8 (cumulative through 7 is 46,812,220).
    assert.equal(d.generation, 8);
    assert.equal(d.cumulativeAtGeneration.toString(), "1591616636");
  });
  it("respects the minimum checksum length", () => {
    assert.equal(expandableDesign(designInput({ minimumChecksumLength: 3 }))!.checksumLength, 3);
    assert.equal(expandableDesign(designInput({ minimumChecksumLength: 0 }))!.checksumLength, 2);
  });
  it("returns null when the delimiter collides with every alphabet", () => {
    assert.equal(expandableDesign(designInput({ separator: "A", allowDigits: false })), null);
  });
});
