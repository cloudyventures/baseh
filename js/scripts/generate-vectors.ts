/**
 * Generates the frozen cross-language vectors in ../vectors/.
 * Deterministic: ids come from a fixed LCG, keys are published test keys.
 * Run from js/: npm run vectors
 */
import { writeFileSync } from "node:fs";
import {
  Baseh, basehMinimumV1, basehLightV1, basehMediumV1, basehHeavyV1,
  FROZEN_KEY_BYTES, prepareProfile, calculateChecksum, permute, inversePermute
} from "../src/index.js";

const FROZEN_KEY_HEX = [...FROZEN_KEY_BYTES].map((b) => b.toString(16).padStart(2, "0")).join("");
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

/**
 * Classic 32-symbol test profiles, kept identical to earlier vector versions
 * so correction and permutation vectors stay stable across the tier rework.
 */
function alpha32TestProfile(profileId: string, permutation: BasehProfile["permutation"]): BasehProfile {
  return {
    profileId,
    bodyAlphabet: "0123456789ABCDEFGHJKMNPQRSTVWXYZ",
    bodyLength: 6,
    checksumAlphabet: "234679ACDEFGHJKMNPQRTUVWXY",
    checksumLength: 1,
    caseSensitive: false,
    separator: "",
    grouping: [],
    aliases: { O: "0", I: "1", L: "1" },
    permutation
  };
}

function profiles(): VectorProfile[] {
  // Frozen tiers permute with the published frozen key; a caller-keyed mapping
  // is exercised by the dedicated perm-test profile below.
  const noPerm = alpha32TestProfile("baseh32-noperm-test", { enabled: false });
  const permTest = alpha32TestProfile("baseh32-perm-test", {
    enabled: true,
    algorithm: "feistel-v1",
    keyId: "test-01",
    keyBytes: TEST_KEY,
    rounds: 8
  });
  return [
    { profile: basehMinimumV1(), keyHex: FROZEN_KEY_HEX },
    { profile: basehLightV1(), keyHex: FROZEN_KEY_HEX },
    { profile: basehMediumV1(), keyHex: FROZEN_KEY_HEX },
    { profile: basehHeavyV1(), keyHex: FROZEN_KEY_HEX },
    { profile: noPerm, keyHex: null },
    { profile: permTest, keyHex: TEST_KEY_HEX }
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
const encodeErrors: unknown[] = [];

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
        : { enabled: false },
      ...(profile.profanity ? { profanity: profile.profanity } : {})
    },
    capacity: prepared.capacity.toString()
  };
  profileEntries.push(entry);

  for (const id of idsFor(prepared.capacity)) {
    let canonical: string;
    try {
      canonical = h.encode(id);
    } catch (e) {
      // Blocklist tiers reserve some ids; record the failure as a vector.
      const code = (e as { code?: string }).code;
      if (code === "BLOCKED_CODE") {
        encodeErrors.push({ profileId: profile.profileId, id: id.toString(10), error: "BLOCKED_CODE" });
        continue;
      }
      throw e;
    }
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
  const base = basehMediumV1();
  const h = new Baseh(base);
  const canonical = h.encode(123456789n);
  (codecVectors as unknown[]).push(
    { profileId: base.profileId, input: canonical.toLowerCase(), id: "123456789", canonicalCode: canonical, note: "lowercase" },
    { profileId: base.profileId, input: canonical.replaceAll("-", ""), id: "123456789", canonicalCode: canonical, note: "no separators" },
    { profileId: base.profileId, input: "  " + canonical + " ", id: "123456789", canonicalCode: canonical, note: "whitespace" }
  );
}

// Decode-side vectors: stripped leading zero body symbols (spec 3.4). The
// decoder re-pads the body before validation; the frozen permutation then maps
// the zero-padded body to its identifier.
{
  const base = basehMediumV1();
  const h = new Baseh(base);
  for (const body of ["000000", "000001", "00000Z"]) {
    const stripped = body.replace(/^0+(?=.)/, "") + calculateChecksum(h.profile, body);
    const id = h.decode(stripped).id;
    codecVectors.push({
      profileId: base.profileId,
      input: stripped,
      id: id.toString(10),
      canonicalCode: h.encode(id),
      note: "stripped leading zeros"
    } as never);
  }
}
{
  const base = basehMinimumV1();
  const h = new Baseh(base);
  const id = h.decode("0").id;
  codecVectors.push({
    profileId: base.profileId,
    input: "0",
    id: id.toString(10),
    canonicalCode: h.encode(id),
    note: "stripped leading zeros, no checksum"
  } as never);
}

// Decode-side vectors: look-alike aliases on the frozen Medium tier. B and S
// are never issued, so typed B decodes as 8 and typed S as 5.
{
  const base = basehMediumV1();
  const h = new Baseh(base);
  for (const [src, tgt] of [["B", "8"], ["S", "5"]] as const) {
    for (let id = 1n; id < 100000n; id += 1n) {
      let canonical: string;
      try {
        canonical = h.encode(id);
      } catch {
        continue; // blocklisted ids are reserved, skip them
      }
      if (canonical.includes(tgt)) {
        codecVectors.push({
          profileId: base.profileId,
          input: canonical.replace(tgt, src),
          id: id.toString(10),
          canonicalCode: canonical,
          note: `look-alike alias: typed ${src} decodes as ${tgt}`
        } as never);
        break;
      }
    }
  }
}

// Error vectors.
const errorVectors: unknown[] = [
  { profileId: "baseh-medium-v1", input: "0000000", error: "INVALID_CHECKSUM" },
  // short inputs now re-pad and fail on the checksum (spec 3.4)
  { profileId: "baseh-medium-v1", input: "00000", error: "INVALID_CHECKSUM" },
  { profileId: "baseh-medium-v1", input: "0000@0X", error: "INVALID_CHARACTER" },
  { profileId: "baseh-medium-v1", input: "0000PD", error: "INVALID_CHECKSUM" },
  { profileId: "baseh-medium-v1", input: "00000000C", error: "INVALID_LENGTH" },
  { profileId: "baseh-medium-v1", input: "", error: "INVALID_LENGTH" },
  // U exists only in the heavy checksum alphabet; placed in the body region
  // it must fail as INVALID_CHARACTER (spec 9), not crash and not pass through.
  { profileId: "baseh-heavy-v1", input: "U00000A", error: "INVALID_CHARACTER" }
];
// checksum-failing code built deterministically from a real body
{
  const base = basehMediumV1();
  const h = new Baseh(base);
  const canonical = h.encode(77n);
  const raw = canonical.replaceAll("-", "");
  const badCheck = raw[6] === "2" ? "3" : "2";
  const bad = raw.slice(0, 6) + badCheck + raw[7];
  errorVectors.push({ profileId: base.profileId, input: bad, error: "INVALID_CHECKSUM" });
  void h;
}

// Correction vectors (frozen case from the spec's ambiguity analysis, modulus 26).
// Checksums must be computed under the exact profile the vectors name:
// baseh32-noperm-test, whose profileId is part of the checksum domain.
const correctionVectors: unknown[] = (() => {
  const noPerm = alpha32TestProfile("baseh32-noperm-test", { enabled: false });
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
