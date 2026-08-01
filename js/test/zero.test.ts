import test from "node:test";
import assert from "node:assert/strict";
import { Baseh, BasehError, basehMediumV1, type BasehErrorCode } from "../src/index.js";
import { fromCode, toCode } from "../src/zero.js";

const medium = new Baseh(basehMediumV1());

const throwsCode = (fn: () => unknown, code: BasehErrorCode) =>
  assert.throws(fn, (e: unknown) => e instanceof BasehError && e.code === code);

test("zero-config matches the frozen Medium profile exactly", () => {
  assert.equal(toCode(0n), medium.encode(0n));
  assert.equal(toCode(123456789n), medium.encode(123456789n));
  assert.equal(toCode(481890303n), "H3C9-2PEM");
});

test("toCode accepts bigint, safe-integer number and decimal string", () => {
  assert.equal(toCode(123456789n), toCode(123456789));
  assert.equal(toCode(123456789n), toCode("123456789"));
  assert.throws(() => toCode(-1), TypeError);
  assert.throws(() => toCode(2 ** 53), TypeError);
  assert.throws(() => toCode("12x3"), TypeError);
  assert.throws(() => toCode(""), TypeError);
});

test("toCode throws on out of range and blocklisted identifiers", () => {
  throwsCode(() => toCode(481890304n), "OUT_OF_RANGE");
  // 813 is reserved by the Medium blocklist once the frozen permutation is applied.
  throwsCode(() => toCode(813n), "BLOCKED_CODE");
});

test("fromCode returns a bigint and round-trips", () => {
  const id = fromCode(toCode(123456789n));
  assert.equal(typeof id, "bigint");
  assert.equal(id, 123456789n);
});

test("fromCode accepts lowercase, aliases and any whitespace", () => {
  const c = toCode(123456789n);
  assert.equal(fromCode(c.toLowerCase()), 123456789n);
  assert.equal(fromCode(`  ${c.slice(0, 3)} ${c.slice(3, 5)}\t${c.slice(5)} `), 123456789n);
  // Typed aliases decode to canonical values: O reads as 0.
  assert.equal(fromCode("UORY-PDCA"), 1n);
});

test("fromCode throws on invalid input, with no correction attempt", () => {
  throwsCode(() => fromCode("00000000"), "INVALID_CHECKSUM");
  throwsCode(() => fromCode("!!!!!!!!"), "INVALID_CHARACTER");
  // B is an alias at Medium: it decodes as 8 rather than failing.
  let code8 = "";
  let id8 = -1n;
  for (let id = 1n; id < 100000n; id += 1n) {
    code8 = toCode(id);
    if (code8.includes("8")) { id8 = id; break; }
  }
  assert.equal(fromCode(code8.replace("8", "B")), id8);
  throwsCode(() => fromCode(""), "INVALID_LENGTH");
});
