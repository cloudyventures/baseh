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
show('fromCode("C8XP-8J49")', () => fromCode("C8XP-8J49"));
show('fromCode("c8xp 8j4 9")', () => fromCode("c8xp 8j4 9"));
show('fromCode("C8XP-8J4X") (checksum typo)', () => fromCode("C8XP-8J4X"));
show("toCode(481890304n) (out of range)", () => toCode(481890304n));

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
