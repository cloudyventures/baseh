/**
 * Runnable examples for the baseh JavaScript/TypeScript package.
 * Run from js/:  ./node_modules/.bin/tsx examples/examples.ts
 */
import { Baseh, BasehError, basehExpandableV1, basehMediumV1, encode, decode } from "../src/index.js";

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

// 0. Expandable mode: shipping in the next release; shown here as the new
// default. Codes start at 4 characters and grow automatically as ids climb
// past each length's capacity. No `0`/`O` in the body, no left-padding, and
// no separator until codes reach 6 characters. Shorter codes already issued
// keep decoding forever.
console.log("== expandable ==");
const expandable = new Baseh(basehExpandableV1());
show("encode(42n)", () => expandable.encode(42n));
show("encode(123456789n)", () => expandable.encode(123456789n));
show("decode round trip", () => {
  const code = expandable.encode(42n); // 4 characters at this namespace size; grows as ids climb
  return expandable.decode(code).id;
});

// 1. Zero configuration: the package-level encode/decode facade over the
// default expandable v1 profile. decode returns the full DecodeResult.
console.log("== zero config ==");
show("encode(123456789n)", () => encode(123456789n));
show("encode(123456789)", () => encode(123456789));
show('decode("...") round trip', () => decode(encode(123456789n)).id);
show("decode (bogus code)", () => decode("ZZZZ-ZZZZ"));

// 2. A frozen preset: load baseh-medium-v1 and use the full codec.
console.log("== preset ==");
const medium = new Baseh(basehMediumV1());
show("encode(123456789n)", () => medium.encode(123456789n));
show('decode("C8XP-8J49").id', () => medium.decode("C8XP-8J49").id);
show('decode("UORY-PDCA").id (typed O reads as 0)', () => medium.decode("UORY-PDCA").id);
show("encode(813n) (blocked word)", () => medium.encode(813n));
show('decode("C8XP-8JX9") (checksum typo)', () => medium.decode("C8XP-8JX9"));
show("capacity", () => medium.capacity());

// 3. Correction: when a typo fails the checksum but a spoken-confusion swap
// fixes exactly one candidate, decode returns the amended code. The frozen
// Medium tier absorbs common swaps as direct aliases, so this demo uses a
// custom full-alphabet profile like the spec's correction vectors.
console.log("== correction ==");
const tickets = new Baseh({
  profileId: "tickets-v1",
  bodyAlphabet: "0123456789ABCDEFGHJKMNPQRSTVWXYZ",
  bodyLength: 6,
  checksumAlphabet: "234679ACDEFGHJKMNPQRTUVWXY",
  checksumLength: 2,
  caseSensitive: false,
  separator: "-",
  grouping: [4, 4],
  aliases: { O: "0", I: "1", L: "1" },
  permutation: { enabled: false }
});
show('decode("00000BKD") (heard B for D)', () => {
  const r = tickets.decode("00000BKD", { tryCorrection: true, confusionProfile: "light" });
  return `Identifier: ${r.id}${r.corrected ? `, corrected to ${r.canonicalCode}` : ""}`;
});

// 4. Customized: load a preset, extend the body and keep the hyphen.
console.log("== customized ==");
const custom = basehMediumV1();
custom.profileId = "orders-v1";
custom.bodyLength = 7;
custom.grouping = [5, 4];
const orders = new Baseh(custom);
show("encode(123456789n)", () => orders.encode(123456789n));
show('decode(...) round trip', () => orders.decode(orders.encode(123456789n)).id);
show('decode("ZC8VR-EMJX") (bad check)', () => orders.decode("ZC8VR-EMJX"));
show("capacity", () => orders.capacity());

// 5. Customized expandable: start from the expandable tier and tune how
// codes grow. `mode` is already "expandable" on this profile; `minLength`
// sets the starting length and `separatorMinLength` sets when hyphenated
// rendering kicks in (the balanced split of spec 19.5, nothing to
// configure). Also part of the next release, like section 0.
console.log("== customized expandable ==");
const growable = basehExpandableV1();
growable.profileId = "invoices-v1";
growable.mode = "expandable";
growable.minLength = 5;
growable.separatorMinLength = 8;
const invoices = new Baseh(growable);
show("encode(42n)", () => invoices.encode(42n)); // starts at 5 characters, no separator until 8+
show("decode round trip", () => {
  const code = invoices.encode(42n);
  return invoices.decode(code).id;
});

// 6. A view helper for route handlers: one shared codec built at module
// scope, records rendered as codes at the edge. In Express, pass the string
// to the template (res.render("order", { code: basehCode(order) })) or
// register it as a view helper; here it is exercised framework-free with a
// plain object. The matching decode-side pattern is in docs/cookbook.md
// ("Framework view helpers").
console.log("== view helper ==");
const codec = new Baseh(basehExpandableV1());
function basehCode(record: { id: bigint }): string {
  return codec.encode(record.id);
}
const order = { id: 123456n };
console.log(`basehCode(order) -> ${JSON.stringify(basehCode(order))}`);
show("decode round trip", () => codec.decode(basehCode(order)).id);
show("decode (bogus code)", () => codec.decode("ZZZZ-ZZZZ").id);
