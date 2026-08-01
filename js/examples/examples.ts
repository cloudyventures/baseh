/**
 * Runnable examples for the baseh JavaScript/TypeScript package.
 * Run from js/:  ./node_modules/.bin/tsx examples/examples.ts
 */
import { Baseh, BasehError, basehMediumV1 } from "../src/index.js";
import { toCode, fromCode } from "../src/index.js";

function show(label: string, fn: () => unknown): void {
  try {
    const out = fn();
    console.log(`${label} -> ${typeof out === "string" ? JSON.stringify(out) : out}`);
  } catch (e) {
    if (e instanceof BasehError) {
      console.log(`${label} -> throws BasehError [${e.code}]: ${e.message}`);
    } else if (e instanceof Error) {
      console.log(`${label} -> throws ${e.constructor.name}: ${e.message}`);
    }
  }
}

// 1. Zero configuration: the default Medium tier behind two functions.
console.log("== zero config ==");
show("toCode(123456789n)", () => toCode(123456789n));
show('toCode("123456789")', () => toCode("123456789"));
show('fromCode("74UYC19")', () => fromCode("74UYC19"));
show('fromCode("74uyc 19")', () => fromCode("74uyc 19"));
show('fromCode("74UYC1X")', () => fromCode("74UYC1X"));
show("toCode(481890304n)", () => toCode(481890304n));

// 2. A frozen preset: load baseh-medium-v1 and use the full codec.
console.log("== preset ==");
const medium = new Baseh(basehMediumV1());
show("encode(123456789n)", () => medium.encode(123456789n));
show('decode("74UYC19").id', () => medium.decode("74UYC19").id);
show('decode("OOOOOOC").id (typed aliases)', () => medium.decode("OOOOOOC").id);
show("encode(1131n) (blocked word)", () => medium.encode(1131n));
show('decode("742YC19") (checksum typo)', () => medium.decode("742YC19"));
show("capacity", () => medium.capacity());

// 3. Customized: load a preset, extend the body and add a delimiter.
console.log("== customized ==");
const custom = basehMediumV1();
custom.profileId = "orders-v1";
custom.bodyLength = 7;
custom.separator = "-";
custom.grouping = [4, 4];
const orders = new Baseh(custom);
show("encode(123456789n)", () => orders.encode(123456789n));
show('decode(...) round trip', () => orders.decode(orders.encode(123456789n)).id);
show('decode("D4UY-C190") (bad check)', () => orders.decode("D4UY-C190"));
show("capacity", () => orders.capacity());
