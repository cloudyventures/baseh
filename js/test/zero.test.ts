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
  assert.equal(toCode(481890303n), "ZZZZZZV");
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
  // 1131 is reserved by the Medium blocklist.
  throwsCode(() => toCode(1131n), "BLOCKED_CODE");
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
  // Typed aliases decode to canonical values.
  assert.equal(fromCode("OOOOOOC"), 0n);
});

test("fromCode throws on invalid input, with no correction attempt", () => {
  throwsCode(() => fromCode("0000000"), "INVALID_CHECKSUM");
  throwsCode(() => fromCode("!!!!!!!"), "INVALID_CHARACTER");
  // B is not canonical in Medium and is not an alias; no correction guesses it.
  throwsCode(() => fromCode("B00000C"), "INVALID_CHARACTER");
  throwsCode(() => fromCode(""), "INVALID_LENGTH");
});
