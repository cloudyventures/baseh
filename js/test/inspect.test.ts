import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Baseh,
  basehMediumV1,
  basehMinimumV1,
  basehHeavyV1,
  basehExpandableV1,
  inspect,
  type InspectResult
} from "../src/index.js";

const medium = new Baseh(basehMediumV1()); // fixed, expected 8, grouping [4,4]
const expandable = new Baseh(basehExpandableV1()); // minLength 4, separatorMinLength 6

function statesOf(inputs: string[]): InspectResult[] {
  return inputs.map((i) => medium.inspect(i));
}

describe("inspect: fixed mode (baseh-medium-v1)", () => {
  it("empty states", () => {
    assert.deepEqual(medium.inspect(""), { state: "empty" });
    assert.deepEqual(medium.inspect("   "), { state: "empty" });
    assert.deepEqual(medium.inspect(" - \t"), { state: "empty" });
  });

  it("typing: prefixes of a real code carry normalized symbols and progress", () => {
    const canonical = medium.encode(123456789n); // e.g. "XXXX-XXXX"
    const raw = canonical.replaceAll("-", "");
    for (let n = 1; n < 8; n += 1) {
      const r = medium.inspect(raw.slice(0, n));
      assert.equal(r.state, "typing", `prefix ${n}`);
      if (r.state !== "typing") throw new Error("unreachable");
      assert.equal(r.typed.replaceAll("-", ""), raw.slice(0, n));
      assert.equal(r.progress, n / 8);
    }
    // separators inserted as far as the groups go (grouping [4, 4])
    const r5 = medium.inspect(raw.slice(0, 5));
    assert.equal(r5.state, "typing");
    if (r5.state === "typing") assert.equal(r5.typed, raw.slice(0, 4) + "-" + raw.slice(4, 5));
  });

  it("typing: lowercase and aliases normalize while typing", () => {
    const canonical = medium.encode(123456789n);
    const raw = canonical.replaceAll("-", "");
    const lower = medium.inspect(raw.slice(0, 5).toLowerCase());
    assert.equal(lower.state, "typing");
    if (lower.state === "typing") assert.equal(lower.typed, raw.slice(0, 4) + "-" + raw[4]);
    // alias source typed mid-code normalizes to its target (O -> 0 etc.)
    const aliasProfile = new Baseh({ ...basehMediumV1(), permutation: { enabled: false }, profanity: { mode: "none" }, maxRepetition: 0 });
    const aliased = aliasProfile.inspect("OIL");
    assert.equal(aliased.state, "typing");
    if (aliased.state === "typing") assert.equal(aliased.typed, "011");
  });

  it("typing: whitespace and stray separators are ignored for counting", () => {
    const canonical = medium.encode(123456789n);
    const raw = canonical.replaceAll("-", "");
    const messy = " " + raw.slice(0, 2) + " -" + raw.slice(2, 5) + "\t";
    const r = medium.inspect(messy);
    assert.equal(r.state, "typing");
    if (r.state === "typing") assert.equal(r.typed.replaceAll("-", ""), raw.slice(0, 5));
  });

  it("spec 3.4: a padded prefix that passes the checksum still reports typing", () => {
    // Find a short input whose re-padded form validates (the cookbook's
    // "false green"), on a filter-free clone so the scan is not disturbed by
    // the blocklist or repetition filter.
    const clone = new Baseh({ ...basehMediumV1(), profanity: { mode: "none" }, maxRepetition: 0 });
    let found: string | null = null;
    for (let id = 0n; id < 200000n && found === null; id += 1n) {
      const raw = clone.encode(id).replaceAll("-", "");
      const stripped = raw.replace(/^0+(?=.)/, "");
      if (stripped.length < raw.length && stripped.length >= 2 && clone.validate(stripped).valid) {
        found = stripped;
      }
    }
    assert.notEqual(found, null, "no false-green prefix found in scan window");
    const r = medium.inspect(found as string);
    assert.equal(r.state, "typing");
  });

  it("valid: complete code, with id and canonicalCode", () => {
    const canonical = medium.encode(123456789n);
    const r = medium.inspect(canonical);
    assert.deepEqual(r, { state: "valid", id: 123456789n, canonicalCode: canonical });
    // no separators, lowercase, surrounding whitespace all reach valid
    assert.deepEqual(medium.inspect(" " + canonical.replaceAll("-", "").toLowerCase() + " "), r);
  });

  it("valid: alias-typed complete code decodes", () => {
    const clone = new Baseh({ ...basehMediumV1(), profanity: { mode: "none" }, maxRepetition: 0 });
    // find a code containing 8, type it with B (B -> 8)
    for (let id = 1n; id < 100000n; id += 1n) {
      const raw = clone.encode(id).replaceAll("-", "");
      if (raw.includes("8")) {
        const r = clone.inspect(raw.replace("8", "B"));
        assert.equal(r.state, "valid");
        if (r.state === "valid") assert.equal(r.id, id);
        return;
      }
    }
    throw new Error("no code containing 8 found");
  });

  it("invalid: complete code with a wrong checksum carries the reason", () => {
    const canonical = medium.encode(77n);
    const raw = canonical.replaceAll("-", "");
    const badCheck = raw[6] === "2" ? "3" : "2";
    const bad = raw.slice(0, 6) + badCheck + raw[7];
    const r = medium.inspect(bad);
    assert.deepEqual(r, { state: "invalid", reason: "INVALID_CHECKSUM" });
  });

  it("bad-char: symbol outside both alphabets, typing or complete", () => {
    assert.deepEqual(medium.inspect("12@"), { state: "bad-char" });
    assert.deepEqual(medium.inspect("1234-56@8"), { state: "bad-char" });
  });

  it("a checksum-only symbol in the body region is invalid, not bad-char", () => {
    // U is in the Heavy checksum alphabet but not its body alphabet: it
    // passes the union-membership gate and fails under validate, exactly
    // like the shared error vector (heavy "U00000A" -> INVALID_CHARACTER).
    const heavy = new Baseh(basehHeavyV1());
    const r = heavy.inspect("U000000A");
    assert.deepEqual(r, { state: "invalid", reason: "INVALID_CHARACTER" });
  });

  it("too-long: more than bodyLength + checksumLength symbols", () => {
    assert.deepEqual(medium.inspect("00000000C"), { state: "too-long" });
    assert.deepEqual(medium.inspect("0000-0000-C"), { state: "too-long" });
  });

  it("no-checksum fixed profile: every complete length validates", () => {
    const minimum = new Baseh(basehMinimumV1()); // 6 symbols, no checksum
    const canonical = minimum.encode(42n);
    const r = minimum.inspect(canonical);
    assert.equal(r.state, "valid");
    for (const s of statesOf([canonical.slice(0, 3)])) assert.equal(s.state, "typing");
  });
});

describe("inspect: expandable mode (baseh-expandable-v1)", () => {
  it("empty and below-minLength typing", () => {
    assert.deepEqual(expandable.inspect(""), { state: "empty" });
    assert.deepEqual(expandable.inspect("1"), { state: "typing", typed: "1", progress: 0.25 });
    assert.deepEqual(expandable.inspect("12"), { state: "typing", typed: "12", progress: 0.5 });
    assert.deepEqual(expandable.inspect("123"), { state: "typing", typed: "123", progress: 0.75 });
    // below separatorMinLength the typing render is bare (B aliases to 8)
    assert.deepEqual(expandable.inspect("ab"), { state: "typing", typed: "A8", progress: 0.5 });
    // aliases normalize while typing (O -> 0, and 0 is a checksum-alphabet symbol)
    assert.deepEqual(expandable.inspect("O"), { state: "typing", typed: "0", progress: 0.25 });
  });

  it("generation boundaries: minLength is the first complete length", () => {
    const code4 = expandable.encode(0n); // first id, generation 4
    assert.equal(code4.length, 4);
    assert.deepEqual(expandable.inspect(code4), { state: "valid", id: 0n, canonicalCode: code4 });
    const code5 = expandable.encode(19683n); // first id of generation 5
    assert.equal(code5.length, 5);
    assert.deepEqual(expandable.inspect(code5), { state: "valid", id: 19683n, canonicalCode: code5 });
    const code6 = expandable.encode(551124n); // first id of generation 6, renders with a hyphen
    assert.equal(code6.length, 7);
    assert.deepEqual(expandable.inspect(code6), { state: "valid", id: 551124n, canonicalCode: code6 });
  });

  it("every length >= minLength is complete: a bad checksum is invalid, not typing", () => {
    // 5 symbols that fail the generation-5 checksum
    const sample = expandable.encode(777n).replaceAll("-", ""); // generation 4
    const five = sample + "A"; // wrong-length presentation, checksum fails (spec 19.7)
    const r = expandable.inspect(five);
    assert.equal(r.state, "invalid");
    if (r.state === "invalid") assert.equal(r.reason, "INVALID_CHECKSUM");
  });

  it("0 or O in a body position is invalid with INVALID_CHARACTER", () => {
    const sample = expandable.encode(777n).replaceAll("-", "");
    for (const bad of ["0" + sample.slice(1), "O" + sample.slice(1)]) {
      const r = expandable.inspect(bad);
      assert.deepEqual(r, { state: "invalid", reason: "INVALID_CHARACTER" });
    }
  });

  it("bad-char and too-long", () => {
    assert.deepEqual(expandable.inspect("A@"), { state: "bad-char" });
    assert.deepEqual(expandable.inspect("ABCD@"), { state: "bad-char" });
    assert.deepEqual(expandable.inspect("A".repeat(33)), { state: "too-long" });
    // 32 real symbols pass the length gate and land on validate
    const r = expandable.inspect("A".repeat(32));
    assert.equal(r.state, "invalid");
  });

  it("whitespace and separators in a complete code still reach valid", () => {
    const code6 = expandable.encode(551124n);
    const raw = code6.replaceAll("-", "");
    const r = expandable.inspect(" " + raw.slice(0, 3) + " - " + raw.slice(3));
    assert.deepEqual(r, { state: "valid", id: 551124n, canonicalCode: code6 });
  });
});

describe("inspect: zero-config facade", () => {
  it("matches a default-profile instance", () => {
    for (const input of ["", "1", "AB@", "A".repeat(33), expandable.encode(42n)]) {
      assert.deepEqual(inspect(input), expandable.inspect(input));
    }
    const r = inspect(expandable.encode(42n));
    assert.equal(r.state, "valid");
  });
});
