import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hrc, HrcError, inversePermute, permute } from "../src/index.js";
import type { HrcProfile } from "../src/index.js";

interface ProfileDef extends Omit<HrcProfile, "permutation"> {
  permutation:
    | { enabled: false }
    | { enabled: true; algorithm: "feistel-v1"; keyId: string; keyBytesHex: string; rounds: number };
}

const vectors = JSON.parse(readFileSync(new URL("../../vectors/vectors.json", import.meta.url), "utf8"));
const feistel = JSON.parse(readFileSync(new URL("../../vectors/feistel-vectors.json", import.meta.url), "utf8"));

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const codecs = new Map<string, Hrc>();
for (const p of vectors.profiles) {
  const def = p.definition as ProfileDef;
  const profile: HrcProfile = {
    ...def,
    permutation: def.permutation.enabled
      ? {
          enabled: true,
          algorithm: "feistel-v1",
          keyId: def.permutation.keyId,
          keyBytes: hexToBytes(def.permutation.keyBytesHex),
          rounds: def.permutation.rounds
        }
      : { enabled: false }
  };
  codecs.set(p.profileId, new Hrc(profile));
}

describe("frozen encode/decode vectors", () => {
  for (const v of vectors.vectors) {
    it(`${v.profileId} id ${v.id}`, () => {
      const h = codecs.get(v.profileId) as Hrc;
      assert.equal(h.encode(BigInt(v.id)), v.canonicalCode);
      const d = h.decode(v.input ?? v.canonicalCode);
      assert.equal(d.id, BigInt(v.id));
      assert.equal(d.canonicalCode, v.canonicalCode);
    });
  }
});

describe("frozen error vectors", () => {
  for (const v of vectors.errors) {
    it(`${v.profileId} ${JSON.stringify(v.input)} -> ${v.error}`, () => {
      const h = codecs.get(v.profileId) as Hrc;
      assert.throws(() => h.decode(v.input), (e: unknown) =>
        e instanceof HrcError && e.code === v.error);
    });
  }
});

describe("frozen correction vectors", () => {
  for (const v of vectors.correction) {
    it(`${v.profileId} ${v.input}`, () => {
      const h = codecs.get(v.profileId) as Hrc;
      const options = { tryCorrection: true, confusionProfile: v.confusionProfile ?? "light" } as const;
      if (v.error) {
        assert.throws(() => h.decode(v.input, options), (e: unknown) =>
          e instanceof HrcError && e.code === v.error);
      } else {
        const d = h.decode(v.input, options);
        assert.equal(d.corrected, v.corrected);
        assert.equal(d.canonicalCode.replaceAll("-", ""), v.expectedBody + v.input.slice(6));
      }
    });
  }
});

describe("frozen feistel vectors", () => {
  for (const v of feistel.vectors) {
    it(`cap ${v.capacity} input ${v.input}`, () => {
      const key = {
        profileId: v.profileId,
        keyBytes: hexToBytes(v.keyBytesHex),
        rounds: v.rounds
      };
      const p = permute(BigInt(v.input), BigInt(v.capacity), key);
      assert.equal(p.toString(), v.permuted);
      assert.equal(inversePermute(p, BigInt(v.capacity), key).toString(), v.input);
    });
  }
});
