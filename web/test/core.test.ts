import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculate, design, minimumLength, parseIdentifier, parseRequired, powBigInt, sampleCodes, type CalculatorInput, type DesignerInput } from "../src/core.js";

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
    shortChecksumLength: 0,
    shortChecksumUntil: 0,
    permutation: false,
    separator: "-",
    maxRepetition: 0,
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
    maxRepetition: 0,
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
    const s = sampleCodes("0123456789ABCDEFGHJKMNPQRSTVWXYZ", 6, 1, 1073741824n, "none", "-", "none", false, 0);
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

describe("parseIdentifier", () => {
  it("accepts zero and plain digits", () => {
    assert.equal(parseIdentifier("0"), 0n);
    assert.equal(parseIdentifier("123456789"), 123456789n);
  });
  it("accepts k m g b t suffixes, case-insensitive", () => {
    assert.equal(parseIdentifier("6k"), 6000n);
    assert.equal(parseIdentifier("2.5M"), 2500000n);
    assert.equal(parseIdentifier("1g"), 1000000000n);
    assert.equal(parseIdentifier("1.5B"), 1500000000n);
    assert.equal(parseIdentifier("6T"), 6000000000000n);
  });
  it("rejects junk", () => {
    assert.equal(parseIdentifier(""), null);
    assert.equal(parseIdentifier("abc"), null);
    assert.equal(parseIdentifier("6x"), null);
    assert.equal(parseIdentifier("-5"), null);
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

describe("expandable generation arithmetic (spec 19.1/19.6/22.3)", async () => {
  const { generationTable, generationForDemand, generationCumulative } = await import("../src/core.js");

  // The spec 22.3 table for the frozen tier: 34-symbol alphabet, checksum
  // length 2, minLength 4, short checksum 1 through length 5.
  it("matches the frozen tier's generation table", () => {
    const rows = generationTable(34, 2, 4, 5, 1, 5);
    const expected: Array<[number, number, string, string]> = [
      [4, 1, "39304", "39304"],
      [5, 1, "1336336", "1375640"],
      [6, 2, "1336336", "2711976"],
      [7, 2, "45435424", "48147400"],
      [8, 2, "1544804416", "1592951816"]
    ];
    for (let i = 0; i < expected.length; i += 1) {
      assert.equal(rows[i]!.length, expected[i]![0]);
      assert.equal(rows[i]!.checksum, expected[i]![1]);
      assert.equal(rows[i]!.capacity.toString(), expected[i]![2]);
      assert.equal(rows[i]!.cumulative.toString(), expected[i]![3]);
    }
  });
  it("with the feature off the table is the pre-22 geometric shape", () => {
    const rows = generationTable(34, 2, 4, 3);
    assert.equal(rows[0]!.capacity.toString(), "1156");
    assert.equal(rows[2]!.cumulative.toString(), "1376796");
    assert.ok(rows.every((r) => r.checksum === 2));
  });
  it("cumulative equals the sum of the generation capacities", () => {
    assert.equal(generationCumulative(34, 2, 4, 6, 1, 5).toString(), "2711976");
  });
  it("generationForDemand lands on the boundary generations", () => {
    assert.equal(generationForDemand(34, 2, 4, 0n, 1, 5), 4);
    assert.equal(generationForDemand(34, 2, 4, 39303n, 1, 5), 4);
    assert.equal(generationForDemand(34, 2, 4, 39304n, 1, 5), 5);
    // The short/normal boundary: the last gen-5 id stays at 5, the next grows.
    assert.equal(generationForDemand(34, 2, 4, 1375639n, 1, 5), 5);
    assert.equal(generationForDemand(34, 2, 4, 1375640n, 1, 5), 6);
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
    codecMode: "expandable", visualSafety: "none", checksumLength: 2,
    // The frozen tier ships the short checksum on (spec 22.5): 1 through length 5.
    shortChecksumLength: 1, shortChecksumUntil: 5, separator: "-", ...overrides
  });

  it("reports a generation table instead of a single capacity", () => {
    const r = calculate(exp());
    assert.ok(r.valid);
    assert.ok(r.generations);
    assert.equal(r.generations![0]!.capacity.toString(), "39304");
    assert.equal(r.generations![0]!.checksum, 1);
    assert.equal(r.generations![2]!.checksum, 2);
    assert.equal(r.maxId, null);
    assert.equal(r.displayedLength, 4);
  });
  it("reports the weaker short-checksum false acceptance through length 5", () => {
    const r = calculate(exp());
    assert.match(r.falseAcceptance, /1 in 35 through length 5/);
    assert.match(r.falseAcceptance, /then 1 in 1225/);
    assert.equal(calculate(exp({ shortChecksumLength: 0, shortChecksumUntil: 0 })).falseAcceptance, "about 1 in 1225");
    // Amendment: a zero-checksum window frames the missing typo detection.
    assert.match(calculate(exp({ shortChecksumLength: 0, shortChecksumUntil: 5 })).falseAcceptance, /no typo detection through length 5/);
  });
  it("validates minLength against the checksum length", () => {
    assert.ok(!calculate(exp({ minLength: 2 })).valid);
    assert.ok(!calculate(exp({ minLength: 0 })).valid);
    assert.ok(!calculate(exp({ separatorMinLength: -1 })).valid);
  });
  it("validates the short checksum window (spec 22.2)", () => {
    // At or above the full checksum length it changes nothing, so reject.
    assert.ok(!calculate(exp({ shortChecksumLength: 2 })).valid);
    assert.ok(!calculate(exp({ checksumLength: 1 })).valid);
    // The window must reach at least the minimum length.
    assert.ok(!calculate(exp({ minLength: 6 })).valid);
    // The smallest generation must keep at least one body symbol.
    assert.ok(!calculate(exp({ minLength: 1, checksumLength: 2, shortChecksumLength: 1, shortChecksumUntil: 5 })).valid);
    // Explicitly off stays valid even with a tiny full checksum.
    assert.ok(calculate(exp({ checksumLength: 1, shortChecksumLength: 0, shortChecksumUntil: 0 })).valid);
    // Amendment: the window is capped at 8; 8 is accepted, 9 is rejected.
    assert.ok(calculate(exp({ shortChecksumUntil: 8 })).valid);
    assert.ok(!calculate(exp({ shortChecksumUntil: 9 })).valid);
    // Amendment: a zero-checksum window (length 0 with a window) is legal.
    assert.ok(calculate(exp({ shortChecksumLength: 0, shortChecksumUntil: 5 })).valid);
    // The length field without a window is rejected.
    assert.ok(!calculate(exp({ shortChecksumLength: 1, shortChecksumUntil: 0 })).valid);
  });
  it("demand analysis names the generation the demand lands in", () => {
    // 1000/day x 3650 days x 1.25 x 2 = 9,125,000 required: generation 7.
    const r = calculate(exp({ recordsPerDay: 1000n, retentionDays: 3650n }));
    assert.equal(r.requiredGeneration, 7);
    assert.equal(r.utilizationStatus, "green");
    assert.ok(r.lifetimeDays !== null && r.lifetimeDays > 0n);
  });
  it("examples span the orders of magnitude with real round trips", () => {
    const r = calculate(exp({ permutation: false }));
    const h = new Baseh(calculatorProfile(exp({ permutation: false }))!);
    // 0, 1, a fixed sample under 1M, then 1M, 1B, 1T, 100T.
    const ids = ["0", "1", "742891", "1000000", "1000000000", "1000000000000", "100000000000000"];
    assert.equal(r.examples.length, ids.length);
    assert.deepEqual(r.examples.map((e) => e.id), ids);
    const byId = new Map(r.examples.filter((e) => !e.blocked).map((e) => [e.id, e.code]));
    // The smallest ids stay at the four-character floor with no separator;
    // the codes grow as the ids do, and 100T is long enough to hyphenate.
    assert.equal(byId.get("0")!.length, 4);
    assert.ok(!byId.get("0")!.includes("-"));
    const lengths = r.examples.filter((e) => !e.blocked).map((e) => e.code.length);
    for (let i = 1; i < lengths.length; i++) assert.ok(lengths[i]! >= lengths[i - 1]!);
    assert.ok(byId.get("100000000000000")!.includes("-"));
    assert.ok(byId.get("100000000000000")!.length > byId.get("0")!.length);
    for (const e of r.examples) {
      if (e.blocked) continue;
      assert.equal(h.decode(e.code).id, BigInt(e.id));
      const raw = e.code.replaceAll("-", "");
      assert.ok(!raw.includes("O"), e.code);
      assert.ok(!raw.slice(0, raw.length - 2).includes("0"), e.code);
    }
  });
  it("decodes a 4-character code against exactly one short checksum symbol", () => {
    const h = new Baseh(calculatorProfile(exp({ permutation: false }))!);
    const code = h.encode(0n);
    assert.equal(code.length, 4);
    // Flipping the single checksum symbol fails; appending a second symbol
    // presents a five-character code whose body/checksum split moves.
    const check = code[3]!;
    const bad = check === "0" ? "1" : "0";
    assert.throws(() => h.decode(code.slice(0, 3) + bad));
    assert.throws(() => h.decode(code + check));
  });
  it("expandable preview codes never contain 0 or O in body positions, even from custom alphabets", () => {
    const r = calculate(exp({ alphabetMode: "custom", customAlphabet: "0123456789O", checksumLength: 1, minLength: 3, shortChecksumLength: 0, shortChecksumUntil: 0 }));
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
    // Spec 22.5: the tier ships the short checksum on, 1 through length 5.
    assert.equal(d.shortChecksumLength, 1);
    assert.equal(d.shortChecksumUntil, 5);
    assert.equal(d.startCapacity.toString(), "39304");
    // 60M ids land in generation 8 (cumulative through 7 is 48,147,400).
    assert.equal(d.generation, 8);
    assert.equal(d.cumulativeAtGeneration.toString(), "1592951816");
  });
  it("respects the minimum checksum length", () => {
    assert.equal(expandableDesign(designInput({ minimumChecksumLength: 3 }))!.checksumLength, 3);
    assert.equal(expandableDesign(designInput({ minimumChecksumLength: 0 }))!.checksumLength, 2);
  });
  it("returns null when the delimiter collides with every alphabet", () => {
    assert.equal(expandableDesign(designInput({ separator: "A", allowDigits: false })), null);
  });
});

describe("short checksum (spec 22)", async () => {
  const { calculatorProfile, effectiveChecksumLengthAt, expandableDesign, expandableProfile, generationTable } = await import("../src/core.js");
  const { Baseh, BasehError, basehExpandableV1, basehExpandablePV1, generationBase } = await import("@cloudyventures/baseh");

  const raw = (code: string) => code.replaceAll("-", "");

  it("the frozen tiers ship the feature on: 1 short checksum through length 5", () => {
    const h = new Baseh(basehExpandableV1());
    assert.equal(h.profile.checksumLength, 2);
    assert.equal(h.profile.shortChecksumLength, 1);
    assert.equal(h.profile.shortChecksumUntil, 5);
    const p = new Baseh(basehExpandablePV1({ keyBytes: new TextEncoder().encode("test-only-key-material-0001"), keyId: "test-01" }));
    assert.equal(p.profile.shortChecksumLength, 1);
    assert.equal(p.profile.shortChecksumUntil, 5);
  });

  it("resolves the effective checksum length per generation", () => {
    assert.equal(effectiveChecksumLengthAt(2, 1, 5, 4), 1);
    assert.equal(effectiveChecksumLengthAt(2, 1, 5, 5), 1);
    assert.equal(effectiveChecksumLengthAt(2, 1, 5, 6), 2);
    assert.equal(effectiveChecksumLengthAt(2, 1, 5, 8), 2);
    assert.equal(effectiveChecksumLengthAt(2, 0, 0, 4), 2);
    const rows = generationTable(34, 2, 4, 5, 1, 5);
    assert.deepEqual(rows.map((r) => r.checksum), [1, 1, 2, 2, 2]);
  });

  it("round trips the short/normal boundary ids 1,375,639 and 1,375,640", () => {
    const h = new Baseh(basehExpandableV1());
    assert.equal(generationBase(h.profile, 6), 1375640n);
    const lastShort = raw(h.encode(1375639n));
    assert.equal(lastShort.length, 5);
    assert.equal(h.decode(lastShort).id, 1375639n);
    const firstNormal = raw(h.encode(1375640n));
    assert.equal(firstNormal.length, 6);
    assert.equal(h.decode(firstNormal).id, 1375640n);
  });

  it("round trips the first id of generations 4 through 8", () => {
    const h = new Baseh(basehExpandableV1());
    for (let l = 4; l <= 8; l += 1) {
      let id: bigint | null = null;
      for (let probe = generationBase(h.profile, l); probe < generationBase(h.profile, l) + 5000n; probe += 1n) {
        try {
          h.encode(probe);
          id = probe;
          break;
        } catch {
          continue;
        }
      }
      assert.ok(id !== null, `no issuable id at generation ${l}`);
      const code = h.encode(id);
      assert.equal(raw(code).length, l);
      assert.equal(h.decode(code).id, id);
    }
  });

  it("the repetition scan spans body and the single short checksum symbol (spec 22.4)", () => {
    const probe = new Baseh({ ...basehExpandableV1(), maxRepetition: 0 });
    let found: bigint | null = null;
    for (let id = 0n; id < generationBase(probe.profile, 5); id += 1n) {
      let code: string;
      try {
        code = probe.encode(id);
      } catch {
        continue;
      }
      const r = raw(code);
      if (r.length === 4 && /(.)\1{3}/.test(r)) {
        found = id;
        break;
      }
    }
    assert.ok(found !== null, "expected a gen-4 code with a run of 4");
    const h = new Baseh(basehExpandableV1());
    assert.throws(() => h.encode(found), (e: unknown) => e instanceof BasehError && e.code === "BLOCKED_CODE");
  });

  it("the separator threshold is still a function of total length (spec 22.4)", () => {
    const h = new Baseh(basehExpandableV1());
    assert.ok(!h.encode(generationBase(h.profile, 5)).includes("-"));
    assert.match(h.encode(generationBase(h.profile, 6)), /^...-...$/);
  });

  it("rejects the short-checksum fields in fixed mode and on bad windows (spec 22.2)", () => {
    const base = basehExpandableV1();
    const bad = [
      { ...base, shortChecksumLength: 2, shortChecksumUntil: 5 },
      { ...base, shortChecksumLength: 1, shortChecksumUntil: 3 },
      { ...base, minLength: 1, shortChecksumLength: 1, shortChecksumUntil: 5 },
      // Amendment: beyond 8 the window would swallow nearly every practical code.
      { ...base, shortChecksumLength: 1, shortChecksumUntil: 9 },
      // Amendment: the length field without a window is invalid.
      { ...base, shortChecksumLength: 1, shortChecksumUntil: 0 },
      { ...base, shortChecksumLength: 1.5, shortChecksumUntil: 5 },
      // Fixed mode: the fields are expandable-only.
      { ...base, mode: "fixed" as const, bodyLength: 6, shortChecksumLength: 1, shortChecksumUntil: 5 }
    ];
    for (const profile of bad) {
      assert.throws(() => new Baseh(profile), (e: unknown) => e instanceof BasehError && e.code === "INVALID_PROFILE");
    }
    // Amendment: until + length 0 is now a legal zero-checksum window.
    const zero = new Baseh({ ...base, shortChecksumLength: 0, shortChecksumUntil: 5 });
    assert.equal(zero.profile.shortChecksumLength, 0);
    assert.equal(zero.profile.shortChecksumUntil, 5);
    // Amendment: until 8 is the top of the range.
    assert.ok(new Baseh({ ...base, shortChecksumLength: 1, shortChecksumUntil: 8 }));
  });

  it("a custom short-checksum window previews and round trips", () => {
    const input = calcInput({
      codecMode: "expandable", checksumLength: 2, shortChecksumLength: 1, shortChecksumUntil: 6,
      permutation: false, separator: "-"
    });
    const h = new Baseh(calculatorProfile(input)!);
    // Body sizes: 3, 4, 5 through length 6 (K = 1), then L - 2.
    assert.equal(generationBase(h.profile, 7) - generationBase(h.profile, 6), 34n ** 5n);
    for (let l = 4; l <= 8; l += 1) {
      const id = generationBase(h.profile, l) + 7n;
      const code = h.encode(id);
      assert.equal(raw(code).length, l);
      assert.equal(h.decode(code).id, id);
    }
  });

  it("the designer's expandable preview profile carries the tier's fields", () => {
    const input = designInput({ requiredCapacity: 60_000_000n });
    const d = expandableDesign(input)!;
    const profile = expandableProfile(d, input, false);
    assert.equal(profile.shortChecksumLength, 1);
    assert.equal(profile.shortChecksumUntil, 5);
    const h = new Baseh(profile);
    assert.equal(raw(h.encode(0n)).length, 4);
  });
});

describe("short checksum: zero-checksum window (spec 22 amendment)", async () => {
  const { effectiveChecksumLengthAt, generationCapacityAt, generationTable } = await import("../src/core.js");
  const { Baseh, BasehError, basehExpandableV1, calculateChecksum, generationBase, generationCapacity } = await import("@cloudyventures/baseh");

  const raw = (code: string) => code.replaceAll("-", "");
  const zeroProfile = {
    ...basehExpandableV1(),
    profileId: "short-zero-test",
    minLength: 4,
    checksumLength: 2,
    shortChecksumLength: 0,
    shortChecksumUntil: 5,
    permutation: { enabled: false } as const,
    profanity: { mode: "none" as const },
    maxRepetition: 0
  };
  const h = new Baseh(zeroProfile);

  it("resolves effective K of 0 inside the window, checksumLength above it", () => {
    assert.equal(effectiveChecksumLengthAt(2, 0, 5, 4), 0);
    assert.equal(effectiveChecksumLengthAt(2, 0, 5, 5), 0);
    assert.equal(effectiveChecksumLengthAt(2, 0, 5, 6), 2);
    assert.deepEqual(generationTable(34, 2, 4, 5, 0, 5).map((r) => r.checksum), [0, 0, 2, 2, 2]);
  });

  it("window generations are all body: capacity is A^L", () => {
    assert.equal(generationCapacityAt(34, 2, 4, 0, 5).toString(), (34n ** 4n).toString());
    assert.equal(generationCapacityAt(34, 2, 5, 0, 5).toString(), (34n ** 5n).toString());
    assert.equal(generationCapacity(h.profile, 4), 34n ** 4n);
    // Above the window the full checksum still reserves its symbols.
    assert.equal(generationCapacity(h.profile, 6), 34n ** 4n);
  });

  it("round trips generations 4-6 with an empty checksum inside the window", () => {
    for (let l = 4; l <= 6; l += 1) {
      for (const offset of [0n, 1n, 7n]) {
        const id = generationBase(h.profile, l) + offset;
        const code = h.encode(id);
        assert.equal(raw(code).length, l);
        if (l <= 5) assert.equal(calculateChecksum(h.profile, raw(code), 0), "");
        assert.equal(h.decode(code).id, id);
        assert.equal(h.decode(code).canonicalCode, code);
      }
    }
  });

  it("a typo at a zero-checksum generation is NOT detected (documented trade-off)", () => {
    const id = generationBase(h.profile, 4) + 1n;
    const code = raw(h.encode(id));
    // Flip the last body symbol to a different body symbol.
    const last = code[3] as string;
    const typed = code.slice(0, 3) + (last === "1" ? "2" : "1");
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
    assert.throws(
      () => filtered.encode(found),
      (e: unknown) => e instanceof BasehError && e.code === "BLOCKED_CODE"
    );
  });
});

describe("short checksum: until-8 window boundary (spec 22 amendment)", async () => {
  const { Baseh, basehExpandableV1, calculateChecksum, generationBase } = await import("@cloudyventures/baseh");

  const raw = (code: string) => code.replaceAll("-", "");
  const h = new Baseh({
    ...basehExpandableV1(),
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

describe("repetition filter (spec 21)", async () => {
  const { calculate, calculatorProfile, candidateProfile, expandableDesign, expandableProfile } = await import("../src/core.js");
  const { Baseh, BasehError } = await import("@cloudyventures/baseh");

  const maxRun = (code: string): number => {
    let best = 1;
    let run = 1;
    for (let i = 1; i < code.length; i += 1) {
      run = code[i] === code[i - 1] ? run + 1 : 1;
      if (run > best) best = run;
    }
    return best;
  };

  // Probe the filter-off twin of a profile for ids whose raw codes carry a
  // run of exactly `run` (or at least `run`) identical symbols.
  const probe = (input: CalculatorInput, run: number, exact: boolean) => {
    const off = new Baseh(calculatorProfile({ ...input, maxRepetition: 0 })!);
    for (let id = 0n; id < 200000n; id += 1n) {
      let code: string;
      try {
        code = off.encode(id);
      } catch {
        continue;
      }
      const raw = code.replaceAll("-", "");
      const r = maxRun(raw);
      if (exact ? r === run : r >= run) return { id, code };
    }
    throw new Error(`no probe id found for run ${run}`);
  };

  it("derivation passes the field through to both preview modes", () => {
    assert.equal(calculatorProfile(calcInput({ maxRepetition: 4 }))!.maxRepetition, 4);
    assert.equal(calculatorProfile(calcInput({ codecMode: "expandable", maxRepetition: 3 }))!.maxRepetition, 3);
    assert.equal(calculatorProfile(calcInput({ maxRepetition: 0 }))!.maxRepetition, 0);
  });

  it("designer candidates and the expandable design carry the filter into their previews", () => {
    const input = designInput({ maxRepetition: 4 });
    const r = design(input);
    assert.ok(r.recommended);
    assert.equal(r.recommended!.maxRepetition, 4);
    assert.equal(candidateProfile(r.recommended!, false).maxRepetition, 4);
    const d = expandableDesign(input)!;
    assert.equal(d.maxRepetition, 4);
    assert.equal(expandableProfile(d, input, false).maxRepetition, 4);
  });

  it("run-4 codes are rejected in preview round trips; run-3 still passes", () => {
    const input = calcInput({ maxRepetition: 4, permutation: false });
    const h = new Baseh(calculatorProfile(input)!);
    const four = probe(input, 4, false);
    assert.throws(() => h.encode(four.id), (e: unknown) => e instanceof BasehError && e.code === "BLOCKED_CODE");
    // Decode reports the same blocked status, since the canonical re-encode
    // passes through the scan (spec 21.3).
    assert.throws(() => h.decode(four.code), (e: unknown) => e instanceof BasehError && e.code === "BLOCKED_CODE");
    const three = probe(input, 3, true);
    assert.equal(h.decode(h.encode(three.id)).id, three.id);
  });

  it("a run straddling the separator still blocks", () => {
    const input = calcInput({ maxRepetition: 4, permutation: false });
    const h = new Baseh(calculatorProfile(input)!);
    const off = new Baseh(calculatorProfile({ ...input, maxRepetition: 0 })!);
    // id 0 is all zero symbols in fixed mode; its separator splits the run.
    const code = off.encode(0n);
    assert.ok(code.includes("-"), code);
    assert.ok(maxRun(code.replaceAll("-", "")) >= 4, code);
    assert.throws(() => h.encode(0n), (e: unknown) => e instanceof BasehError && e.code === "BLOCKED_CODE");
  });

  it("custom value 3 blocks triples", () => {
    const input = calcInput({ maxRepetition: 3, permutation: false });
    const h = new Baseh(calculatorProfile(input)!);
    const three = probe(input, 3, false);
    assert.throws(() => h.encode(three.id), (e: unknown) => e instanceof BasehError && e.code === "BLOCKED_CODE");
  });

  it("capacity is unchanged and blocked examples are marked, not dropped", () => {
    const off = calculate(calcInput({ permutation: false }));
    const on = calculate(calcInput({ maxRepetition: 4, permutation: false }));
    assert.equal(on.capacity, off.capacity);
    assert.ok(on.examples.some((e) => e.blocked), "id 0 is a zero run and must show as blocked");
  });

  it("correction never corrects into a blocked code", () => {
    const input = calcInput({ maxRepetition: 4, permutation: false, checksumLength: 2 });
    const h = new Baseh(calculatorProfile(input)!);
    const four = probe(input, 4, false);
    // Mutating one symbol of a blocked code either fails the checksum or
    // lands on a candidate that is itself blocked; it must never decode.
    const raw = four.code;
    for (let i = 0; i < raw.length; i += 1) {
      if (raw[i] === "-") continue;
      const mutated = raw.slice(0, i) + (raw[i] === "0" ? "1" : "0") + raw.slice(i + 1);
      try {
        const decoded = h.decode(mutated, { tryCorrection: true, confusionProfile: "heavy" });
        assert.notEqual(maxRun(decoded.canonicalCode.replaceAll("-", "")) >= 4, true, mutated);
      } catch (e) {
        assert.ok(e instanceof BasehError, String(e));
      }
    }
  });
});
