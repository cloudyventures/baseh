import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculate, design, minimumLength, powBigInt, type CalculatorInput, type DesignerInput } from "../src/core.js";

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
