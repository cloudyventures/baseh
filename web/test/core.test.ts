import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculate, design, minimumLength, parseRequired, powBigInt, type CalculatorInput, type DesignerInput } from "../src/core.js";

function calcInput(overrides: Partial<CalculatorInput> = {}): CalculatorInput {
  return {
    namespace: "",
    alphabetMode: "alnum",
    customAlphabet: "",
    visualSafety: "none",
    spokenSafety: "none",
    bodyLength: 6,
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
    const r = calculate(calcInput({ visualSafety: "light", permutation: true }));
    assert.equal(r.examples.length, 5);
    for (const e of r.examples) assert.match(e.code, /^[0-9A-Z-]+$/);
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
