/**
 * Generates the frozen cross-language vectors in ../vectors/.
 * Deterministic: ids come from a fixed LCG, keys are published test keys.
 * Run from js/: npm run vectors
 */
import { writeFileSync } from "node:fs";
import {
  Baseh, baseh32V1, baseh32sV1, prepareProfile, calculateChecksum, permute, inversePermute
} from "../src/index.js";
import type { BasehProfile } from "../src/index.js";

const TEST_KEY_HEX = "746573742d6f6e6c792d6b65792d6d6174657269616c2d30303031"; // "test-only-key-material-0001"
const TEST_KEY = new TextEncoder().encode("test-only-key-material-0001");

// Fixed LCG so ids are deterministic across generator runs.
function lcg(seed: bigint): () => bigint {
  let state = seed;
  return () => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return state;
  };
}

interface VectorProfile {
  profile: BasehProfile;
  keyHex: string | null;
}

function profiles(): VectorProfile[] {
  const base = baseh32V1({ keyBytes: TEST_KEY, keyId: "test-01" });
  const strong = baseh32sV1({ keyBytes: TEST_KEY, keyId: "test-01" });
  const noPerm: BasehProfile = { ...base, profileId: "baseh32-noperm-test", permutation: { enabled: false } };
  return [
    { profile: base, keyHex: TEST_KEY_HEX },
    { profile: strong, keyHex: TEST_KEY_HEX },
    { profile: noPerm, keyHex: null }
  ];
}

function idsFor(capacity: bigint): bigint[] {
  const rand = lcg(88172645463325252n);
  const ids = new Set<bigint>([0n, 1n, 2n, 31n, 32n, 33n, capacity - 2n, capacity - 1n]);
  while (ids.size < 40) ids.add(rand() % capacity);
  return [...ids].sort((a, b) => (a < b ? -1 : 1));
}

const codecVectors: unknown[] = [];
const profileEntries: unknown[] = [];

for (const { profile, keyHex } of profiles()) {
  const h = new Baseh(profile);
  const prepared = h.profile;
  const entry: Record<string, unknown> = {
    profileId: profile.profileId,
    definition: {
      profileId: profile.profileId,
      bodyAlphabet: profile.bodyAlphabet,
      bodyLength: profile.bodyLength,
      checksumAlphabet: profile.checksumAlphabet,
      checksumLength: profile.checksumLength,
      caseSensitive: profile.caseSensitive,
      separator: profile.separator,
      grouping: profile.grouping,
      aliases: profile.aliases,
      permutation: profile.permutation.enabled
        ? {
            enabled: true,
            algorithm: "feistel-v1",
            keyId: profile.permutation.keyId,
            keyBytesHex: keyHex,
            rounds: profile.permutation.rounds
          }
        : { enabled: false }
    },
    capacity: prepared.capacity.toString()
  };
  profileEntries.push(entry);

  for (const id of idsFor(prepared.capacity)) {
    const canonical = h.encode(id);
    const raw = canonical.replaceAll("-", "");
    codecVectors.push({
      profileId: profile.profileId,
      id: id.toString(10),
      canonicalCode: canonical,
      rawBody: raw.slice(0, profile.bodyLength),
      rawChecksum: raw.slice(profile.bodyLength)
    });
  }
}

// Decode-side vectors: aliases, case, separators, whitespace.
{
  const base = baseh32V1({ keyBytes: TEST_KEY, keyId: "test-01" });
  const h = new Baseh(base);
  const canonical = h.encode(123456789n);
  (codecVectors as unknown[]).push(
    { profileId: base.profileId, input: canonical.toLowerCase(), id: "123456789", canonicalCode: canonical, note: "lowercase" },
    { profileId: base.profileId, input: canonical.replaceAll("-", ""), id: "123456789", canonicalCode: canonical, note: "no separators" },
    { profileId: base.profileId, input: "  " + canonical + " ", id: "123456789", canonicalCode: canonical, note: "whitespace" }
  );
}

// Error vectors.
const errorVectors: unknown[] = [
  { profileId: "baseh32-v1", input: "0000000", error: "INVALID_CHECKSUM" },
  { profileId: "baseh32-v1", input: "00000", error: "INVALID_LENGTH" },
  { profileId: "baseh32-v1", input: "0000@0X", error: "INVALID_CHARACTER" },
  { profileId: "baseh32-v1", input: "0000PD", error: "INVALID_LENGTH" },
  // U exists only in the checksum alphabet; placed in the body region it must
  // fail as INVALID_CHARACTER (spec 9), not crash and not pass through.
  { profileId: "baseh32-v1", input: "U00000A", error: "INVALID_CHARACTER" }
];
// checksum-failing code built deterministically from a real body
{
  const base = baseh32V1({ keyBytes: TEST_KEY, keyId: "test-01" });
  const h = new Baseh(base);
  const canonical = h.encode(77n);
  const raw = canonical.replaceAll("-", "");
  const badCheck = raw[6] === "2" ? "3" : "2";
  const bad = raw.slice(0, 6) + badCheck;
  errorVectors.push({ profileId: base.profileId, input: bad, error: "INVALID_CHECKSUM" });
  void h;
}

// Correction vectors (frozen case from the spec's ambiguity analysis, modulus 26).
// Checksums must be computed under the exact profile the vectors name:
// baseh32-noperm-test, whose profileId is part of the checksum domain.
const correctionVectors: unknown[] = (() => {
  const base = baseh32V1({ keyBytes: TEST_KEY, keyId: "test-01" });
  const noPerm: BasehProfile = { ...base, profileId: "baseh32-noperm-test", permutation: { enabled: false } };
  const prepared = prepareProfile(noPerm);
  const uniqueCheck = calculateChecksum(prepared, "0000PB");
  const ambCheck = calculateChecksum(prepared, "0000BP");
  const h = new Baseh(noPerm);
  // The unique vector must decode to a body; the ambiguous one must abstain.
  const unique = h.decode("0000TB" + uniqueCheck, { tryCorrection: true, confusionProfile: "light" });
  let ambThrew = false;
  try {
    h.decode("0000BT" + ambCheck, { tryCorrection: true, confusionProfile: "light" });
  } catch (e) {
    ambThrew = e instanceof Error && (e as { code?: string }).code === "AMBIGUOUS_INPUT";
  }
  if (!unique.corrected || !ambThrew) throw new Error("correction vector generation broke");
  return [
    {
      profileId: "baseh32-noperm-test",
      confusionProfile: "light",
      input: "0000TB" + uniqueCheck,
      expectedBody: "0000PB",
      corrected: true
    },
    {
      profileId: "baseh32-noperm-test",
      confusionProfile: "light",
      input: "0000BT" + ambCheck,
      error: "AMBIGUOUS_INPUT"
    }
  ];
})();

// --- Spec 18 profanity safety ----------------------------------------------
const BLOCK_BODY = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BLOCK_CHECK = "234679ACDEFGHJKMNPQRTUVWXY";

function blockProfile(profileId: string, profanity: BasehProfile["profanity"]): BasehProfile {
  return {
    profileId,
    bodyAlphabet: BLOCK_BODY,
    bodyLength: 6,
    checksumAlphabet: BLOCK_CHECK,
    checksumLength: 1,
    caseSensitive: false,
    separator: "",
    grouping: [],
    aliases: { O: "0", I: "1", L: "1" },
    permutation: { enabled: false },
    profanity
  };
}

function profileEntry(profile: BasehProfile, h: Baseh, keyHex: string | null): Record<string, unknown> {
  return {
    profileId: profile.profileId,
    definition: {
      profileId: profile.profileId,
      bodyAlphabet: profile.bodyAlphabet,
      bodyLength: profile.bodyLength,
      checksumAlphabet: profile.checksumAlphabet,
      checksumLength: profile.checksumLength,
      caseSensitive: profile.caseSensitive,
      separator: profile.separator,
      grouping: profile.grouping,
      aliases: profile.aliases,
      permutation: profile.permutation.enabled
        ? {
            enabled: true,
            algorithm: "feistel-v1",
            keyId: profile.permutation.keyId,
            keyBytesHex: keyHex,
            rounds: profile.permutation.rounds
          }
        : { enabled: false },
      ...(profile.profanity ? { profanity: profile.profanity } : {})
    },
    capacity: h.profile.capacity.toString()
  };
}

function encodeEntry(h: Baseh, id: bigint): Record<string, unknown> {
  const canonical = h.encode(id);
  const raw = canonical.replaceAll("-", "");
  return {
    profileId: h.profile.profileId,
    id: id.toString(10),
    canonicalCode: canonical,
    rawBody: raw.slice(0, h.profile.bodyLength),
    rawChecksum: raw.slice(h.profile.bodyLength)
  };
}

function findIdWith(h: Baseh, needle: string): bigint {
  // Probe with a profanity-free twin: the twin's raw output is exactly what the
  // blocklist codec would emit before it rejects the code.
  const probe = new Baseh({ ...h.profile, blocklist: [], profanity: { mode: "none" } });
  for (let id = 0n; id < probe.capacity(); id += 1n) {
    if (probe.encode(id).replaceAll("-", "").toUpperCase().includes(needle)) return id;
  }
  throw new Error(`no id found containing ${needle}`);
}

const blockDefault = blockProfile("block32-test", { mode: "blocklist" });
const blockReplace = blockProfile("block32-replace-test", { mode: "blocklist", words: ["ZZZZ"] });
const blockExtra = blockProfile("block32-extra-test", { mode: "blocklist", extraWords: ["QQQQ"] });
const noVowel = blockProfile("novowel32-test", { mode: "no-vowels" });

const hBlockDefault = new Baseh(blockDefault);
const hBlockReplace = new Baseh(blockReplace);
const hBlockExtra = new Baseh(blockExtra);
const hNoVowel = new Baseh(noVowel);

for (const [p, h] of [
  [blockDefault, hBlockDefault], [blockReplace, hBlockReplace],
  [blockExtra, hBlockExtra], [noVowel, hNoVowel]
] as const) {
  profileEntries.push(profileEntry(p, h, null));
}

const encodeErrors: unknown[] = [];

// Default list: a CRAP-containing code is rejected.
const idCrap = findIdWith(hBlockDefault, "CRAP");
encodeErrors.push({ profileId: "block32-test", id: idCrap.toString(10), error: "BLOCKED_CODE" });

// Replaced list: CRAP is no longer blocked (normal encode vector proves it)
// and the replacement word is.
codecVectors.push(encodeEntry(hBlockReplace, idCrap));
const idZzzz = findIdWith(hBlockReplace, "ZZZZ");
encodeErrors.push({ profileId: "block32-replace-test", id: idZzzz.toString(10), error: "BLOCKED_CODE" });

// Augmented list: both the default CRAP and the extra QQQQ are blocked.
encodeErrors.push({ profileId: "block32-extra-test", id: findIdWith(hBlockExtra, "CRAP").toString(10), error: "BLOCKED_CODE" });
const idQqqq = findIdWith(hBlockExtra, "QQQQ");
encodeErrors.push({ profileId: "block32-extra-test", id: idQqqq.toString(10), error: "BLOCKED_CODE" });

// no-vowels: round-trips over the stripped alphabet plus a vowel input that
// must fail as INVALID_CHARACTER.
for (const id of [0n, 1n, 2n, hNoVowel.capacity() - 1n]) {
  codecVectors.push(encodeEntry(hNoVowel, id));
}
errorVectors.push({ profileId: "novowel32-test", input: "0000A02", error: "INVALID_CHARACTER" });

// Feistel vectors over several capacities, with walk counts.
const feistelVectors: unknown[] = [];
for (const [capacityStr, rounds] of [["100000", 8], ["1073741824", 8], ["36", 4]] as const) {
  const capacity = BigInt(capacityStr);
  const key = { profileId: "feistel-test", keyBytes: TEST_KEY, rounds: rounds as number };
  const rand = lcg(1234567890123456789n);
  const ids = new Set<bigint>([0n, 1n, capacity - 1n]);
  while (ids.size < 12) ids.add(rand() % capacity);
  for (const id of [...ids].sort((a, b) => (a < b ? -1 : 1))) {
    const p = permute(id, capacity, key);
    const inv = inversePermute(p, capacity, key);
    if (inv !== id) throw new Error(`feistel vector generation broke: ${id}`);
    feistelVectors.push({
      profileId: "feistel-test",
      keyBytesHex: TEST_KEY_HEX,
      capacity: capacityStr,
      rounds,
      input: id.toString(10),
      permuted: p.toString(10)
    });
  }
}

writeFileSync(
  new URL("../../vectors/vectors.json", import.meta.url),
  JSON.stringify(
    { version: "1", profiles: profileEntries, vectors: codecVectors, errors: errorVectors, correction: correctionVectors, encodeErrors },
    null,
    2
  ) + "\n"
);
writeFileSync(
  new URL("../../vectors/feistel-vectors.json", import.meta.url),
  JSON.stringify({ version: "1", vectors: feistelVectors }, null, 2) + "\n"
);
console.log(`wrote ${codecVectors.length} codec vectors, ${feistelVectors.length} feistel vectors`);
