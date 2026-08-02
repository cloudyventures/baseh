/**
 * Generates the frozen cross-language vectors in ../vectors/.
 * Deterministic: ids come from a fixed LCG, keys are published test keys.
 * Run from js/: npm run vectors
 */
import { writeFileSync } from "node:fs";
import {
  Baseh, basehMinimumV1, basehLightV1, basehMediumV1, basehHeavyV1,
  basehExpandableV1,
  FROZEN_KEY_BYTES, prepareProfile, calculateChecksum, permute, inversePermute,
  generationBase, generationCapacity, effectiveChecksumLength
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
      ...(profile.profanity ? { profanity: profile.profanity } : {}),
      ...(profile.maxRepetition !== undefined ? { maxRepetition: profile.maxRepetition } : {})
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

// Decode-side error vectors: stripped leading zero body symbols (spec 3.4).
// The frozen tiers ship maxRepetition 4 (spec 21), under which these
// zero-heavy codes are unissuable: the decoder re-pads, validates and then
// reports BLOCKED_CODE when reconstructing the canonical form, exactly like a
// blocklisted code (spec 21.3). The padding leniency itself stays pinned by
// the codec's own unit tests against filter-off clones of the tier shapes.
{
  const base = basehMediumV1();
  const h = new Baseh(base);
  for (const body of ["000000", "000001", "00000Z"]) {
    const stripped = body.replace(/^0+(?=.)/, "") + calculateChecksum(h.profile, body);
    errorVectors.push({ profileId: base.profileId, input: stripped, error: "BLOCKED_CODE" });
  }
}
{
  const base = basehMinimumV1();
  errorVectors.push({ profileId: base.profileId, input: "0", error: "BLOCKED_CODE" });
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
    ...(profanity ? { profanity } : {})
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
      ...(profile.profanity ? { profanity: profile.profanity } : {}),
      ...(profile.maxRepetition !== undefined ? { maxRepetition: profile.maxRepetition } : {})
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
  const probe = new Baseh({ ...h.profile, profanity: { mode: "none" } });
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

// --- Spec 21 repetition filter ----------------------------------------------
// Probe profiles mirror the blocklist shape: no permutation, no separator, so
// runs live entirely in the rendered body/checksum. Ids are found with a
// filter-free twin, exactly like findIdWith above.
function repProfile(profileId: string, maxRepetition: number): BasehProfile {
  return { ...blockProfile(profileId, { mode: "none" }), maxRepetition };
}

function maxRunLength(raw: string): number {
  let best = 1;
  let run = 1;
  for (let i = 1; i < raw.length; i += 1) {
    run = raw[i] === raw[i - 1] ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

function findIdWithRun(profile: BasehProfile, runLength: number): bigint {
  const probe = new Baseh({ ...profile, maxRepetition: 0 });
  for (let id = 0n; id < probe.capacity(); id += 1n) {
    if (maxRunLength(probe.encode(id).replaceAll("-", "")) === runLength) return id;
  }
  throw new Error(`no id with max run ${runLength}`);
}

const rep4 = repProfile("rep32-test", 4);
const rep3 = repProfile("rep3-32-test", 3);
const hRep4 = new Baseh(rep4);
const hRep3 = new Baseh(rep3);
profileEntries.push(profileEntry(rep4, hRep4, null));
profileEntries.push(profileEntry(rep3, hRep3, null));

// Boundary: a run of exactly 3 passes at maxRepetition 4; a run of 4 blocks.
codecVectors.push(encodeEntry(hRep4, findIdWithRun(rep4, 3)));
encodeErrors.push({ profileId: rep4.profileId, id: findIdWithRun(rep4, 4).toString(10), error: "BLOCKED_CODE" });

// Custom maxRepetition 3: a normal round trip plus a blocked triple.
codecVectors.push(encodeEntry(hRep3, findIdWithRun(rep3, 1)));
codecVectors.push(encodeEntry(hRep3, findIdWithRun(rep3, 2)));
encodeErrors.push({ profileId: rep3.profileId, id: findIdWithRun(rep3, 3).toString(10), error: "BLOCKED_CODE" });

// Separators do not break a run (spec 21.2): body AAAA renders AA-AA..., no
// formatted group shows a run of 4, yet the raw run of 4 blocks the encode.
{
  const sepRep: BasehProfile = {
    profileId: "rep16-sep-test",
    bodyAlphabet: "0123456789ABCDEF",
    bodyLength: 4,
    checksumAlphabet: "234679ACDEFGHJKMNPQRTUVWXY",
    checksumLength: 1,
    caseSensitive: false,
    separator: "-",
    grouping: [2, 2, 1],
    aliases: {},
    permutation: { enabled: false },
    maxRepetition: 4
  };
  const hSepRep = new Baseh(sepRep);
  profileEntries.push(profileEntry(sepRep, hSepRep, null));
  codecVectors.push(encodeEntry(hSepRep, 1n));
  const idAaaa = 10n * 16n ** 3n + 10n * 16n ** 2n + 10n * 16n + 10n;
  encodeErrors.push({ profileId: sepRep.profileId, id: idAaaa.toString(10), error: "BLOCKED_CODE" });
}

// --- Multi-character separator ----------------------------------------------
// Separators are removed as a literal substring (spec 3.3): every occurrence
// of the exact separator string is stripped, nothing else. A two-symbol
// separator pins that semantics: a lone "." is not half a separator and must
// fail as INVALID_CHARACTER, while the full ".." strips wherever it appears.
{
  const sepMulti: BasehProfile = {
    profileId: "sep32-multi-test",
    bodyAlphabet: "0123456789ABCDEFGHJKMNPQRSTVWXYZ",
    bodyLength: 6,
    checksumAlphabet: "234679ACDEFGHJKMNPQRTUVWXY",
    checksumLength: 1,
    caseSensitive: false,
    separator: "..",
    grouping: [3, 2, 2],
    aliases: {},
    permutation: { enabled: false }
  };
  const hSepMulti = new Baseh(sepMulti);
  profileEntries.push(profileEntry(sepMulti, hSepMulti, null));

  function sepMultiEntry(id: bigint): Record<string, unknown> {
    const canonical = hSepMulti.encode(id);
    const raw = canonical.split("..").join("");
    return {
      profileId: sepMulti.profileId,
      id: id.toString(10),
      canonicalCode: canonical,
      rawBody: raw.slice(0, sepMulti.bodyLength),
      rawChecksum: raw.slice(sepMulti.bodyLength)
    };
  }

  for (const id of [0n, 1n, 2n, hSepMulti.capacity() - 1n]) {
    codecVectors.push(sepMultiEntry(id));
  }

  // Every occurrence of the full separator strips: a doubled "...." inside
  // the canonical form still decodes to the same id.
  {
    const canonical = hSepMulti.encode(1n);
    codecVectors.push({
      profileId: sepMulti.profileId,
      input: canonical.replace("..", "...."),
      id: "1",
      canonicalCode: canonical,
      note: "doubled multi-character separator strips as two literal occurrences"
    } as never);
  }

  // A lone "." is not a separator occurrence: it stays in the input and must
  // fail as INVALID_CHARACTER, never silently stripped.
  {
    const canonical = hSepMulti.encode(1n);
    errorVectors.push({
      profileId: sepMulti.profileId,
      input: canonical.replaceAll("..", "."),
      error: "INVALID_CHARACTER"
    });
  }
}

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

// --- Spec 19/20 expandable mode ---------------------------------------------
// The expandable tier's definition gains the mode fields; round trips pin the
// exact first/last id of every generation 4-8, rejections pin the error
// codes of spec 19.8, and a per-generation Feistel set pins the
// length-mixed key derivation of spec 7.3/19.4.
{
  const expandable = basehExpandableV1();
  const h = new Baseh(expandable);
  const prepared = h.profile;
  profileEntries.push({
    profileId: expandable.profileId,
    definition: {
      profileId: expandable.profileId,
      mode: "expandable",
      bodyAlphabet: expandable.bodyAlphabet,
      minLength: expandable.minLength,
      checksumAlphabet: expandable.checksumAlphabet,
      checksumLength: expandable.checksumLength,
      shortChecksumLength: expandable.shortChecksumLength,
      shortChecksumUntil: expandable.shortChecksumUntil,
      caseSensitive: expandable.caseSensitive,
      separator: expandable.separator,
      separatorMinLength: expandable.separatorMinLength,
      grouping: expandable.grouping,
      aliases: expandable.aliases,
      permutation: {
        enabled: true,
        algorithm: "feistel-v1",
        keyId: "frozen",
        keyBytesHex: FROZEN_KEY_HEX,
        rounds: 8
      },
      profanity: { mode: "blocklist" },
      maxRepetition: 4
    },
    generations: [4, 5, 6, 7, 8].map((l) => ({
      length: l,
      base: generationBase(prepared, l).toString(10),
      capacity: generationCapacity(prepared, l).toString(10)
    }))
  });

  // Round trips at the exact first and last id of generations 4-8, plus a
  // sampled spread inside each generation.
  const boundary = new Set<bigint>();
  for (let l = 4; l <= 8; l += 1) {
    boundary.add(generationBase(prepared, l));
    boundary.add(generationBase(prepared, l + 1) - 1n);
  }
  const rand = lcg(2654435761n);
  for (let l = 4; l <= 8; l += 1) {
    const base = generationBase(prepared, l);
    const cap = generationCapacity(prepared, l);
    for (let i = 0; i < 6; i += 1) boundary.add(base + rand() % cap);
  }
  for (const id of [...boundary].sort((a, b) => (a < b ? -1 : 1))) {
    let canonical: string;
    try {
      canonical = h.encode(id);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "BLOCKED_CODE") {
        encodeErrors.push({ profileId: expandable.profileId, id: id.toString(10), error: "BLOCKED_CODE" });
        continue;
      }
      throw e;
    }
    const rawCode = canonical.replaceAll("-", "");
    // Spec 22: the body/checksum split uses the generation's effective
    // checksum length (1 at lengths 4-5, 2 from 6 up on the frozen tier).
    const bodyLength = rawCode.length - effectiveChecksumLength(prepared, rawCode.length);
    codecVectors.push({
      profileId: expandable.profileId,
      id: id.toString(10),
      canonicalCode: canonical,
      rawBody: rawCode.slice(0, bodyLength),
      rawChecksum: rawCode.slice(bodyLength)
    });
  }

  // Checksum-with-zero vectors (spec 20.3): pin codes whose checksum
  // contains 0, including one where 0 is the final symbol.
  let zeroInside = 0;
  let zeroFinal: bigint | null = null;
  for (let id = 0n; id < 500000n && (zeroInside < 3 || zeroFinal === null); id += 1n) {
    let canonical: string;
    try {
      canonical = h.encode(id);
    } catch {
      continue;
    }
    const rawCode = canonical.replaceAll("-", "");
    const k = effectiveChecksumLength(prepared, rawCode.length);
    const check = rawCode.slice(rawCode.length - k);
    if (check.endsWith("0") && zeroFinal === null) {
      zeroFinal = id;
    } else if (check.includes("0") && zeroInside < 3) {
      zeroInside += 1;
    } else {
      continue;
    }
    const bodyLength = rawCode.length - k;
    codecVectors.push({
      profileId: expandable.profileId,
      id: id.toString(10),
      canonicalCode: canonical,
      rawBody: rawCode.slice(0, bodyLength),
      rawChecksum: rawCode.slice(bodyLength),
      note: "checksum contains 0"
    } as never);
  }
  if (zeroFinal !== null) {
    // A typed O in a checksum position aliases to 0 (spec 19.2/20.3).
    const canonical = h.encode(zeroFinal);
    const typed = canonical.replaceAll("-", "").slice(0, -1) + "O";
    codecVectors.push({
      profileId: expandable.profileId,
      input: typed,
      id: zeroFinal.toString(10),
      canonicalCode: canonical,
      note: "typed O in checksum position aliases to 0"
    } as never);
  }

  // Rejection vectors (spec 19.8/20.2/20.4/20.5/20.6).
  const sample = h.encode(777n).replaceAll("-", ""); // a generation-4 code
  errorVectors.push(
    { profileId: expandable.profileId, input: "ABC", error: "INVALID_LENGTH" },
    { profileId: expandable.profileId, input: "", error: "INVALID_LENGTH" },
    { profileId: expandable.profileId, input: "A".repeat(33), error: "INVALID_LENGTH" },
    // 0 or O in a body position (after the O -> 0 alias)
    { profileId: expandable.profileId, input: "0" + sample.slice(1), error: "INVALID_CHARACTER" },
    { profileId: expandable.profileId, input: "O" + sample.slice(1), error: "INVALID_CHARACTER" },
    // separator below separatorMinLength (lengths 4 and 5 render bare)
    { profileId: expandable.profileId, input: sample.slice(0, 2) + "-" + sample.slice(2), error: "INVALID_CHARACTER" },
    // wrong-length presentation of an otherwise valid code
    { profileId: expandable.profileId, input: sample + "A", error: "INVALID_CHECKSUM" }
  );

  // Per-generation Feistel vectors (spec 7.3 expandable message encoding).
  for (const l of [4, 5, 6, 7, 8]) {
    const domain = generationCapacity(prepared, l);
    const key = {
      profileId: expandable.profileId,
      keyBytes: FROZEN_KEY_BYTES,
      rounds: 8,
      length: l
    };
    const randF = lcg(BigInt(1000 + l));
    const ids = new Set<bigint>([0n, 1n, domain - 1n]);
    while (ids.size < 8) ids.add(randF() % domain);
    for (const id of [...ids].sort((a, b) => (a < b ? -1 : 1))) {
      const p = permute(id, domain, key);
      if (inversePermute(p, domain, key) !== id) throw new Error(`expandable feistel broke at L=${l}: ${id}`);
      feistelVectors.push({
        profileId: expandable.profileId,
        keyBytesHex: FROZEN_KEY_HEX,
        capacity: domain.toString(10),
        rounds: 8,
        length: l,
        input: id.toString(10),
        permuted: p.toString(10)
      });
    }
  }
}

// --- Spec 22 amendment: zero-checksum and until-8 windows -------------------
// Append-only: every entry above is untouched. These profiles pin the amended
// validation matrix and the effective-K=0 codec paths. Both are permutation-
// off, so the Feistel vector set gains no entries.
const profileErrors: unknown[] = [];
{
  function shortTestProfile(
    profileId: string,
    shortChecksumLength: number,
    shortChecksumUntil: number
  ): BasehProfile {
    return {
      ...basehExpandableV1(),
      profileId,
      minLength: 4,
      checksumLength: 2,
      shortChecksumLength,
      shortChecksumUntil,
      permutation: { enabled: false },
      profanity: { mode: "none" },
      maxRepetition: 0
    };
  }

  function expandableEntry(profile: BasehProfile, prepared: ReturnType<typeof prepareProfile>, maxGen: number): Record<string, unknown> {
    return {
      profileId: profile.profileId,
      definition: {
        profileId: profile.profileId,
        mode: "expandable",
        bodyAlphabet: profile.bodyAlphabet,
        minLength: prepared.minLength,
        checksumAlphabet: profile.checksumAlphabet,
        checksumLength: profile.checksumLength,
        shortChecksumLength: profile.shortChecksumLength,
        shortChecksumUntil: profile.shortChecksumUntil,
        caseSensitive: profile.caseSensitive,
        separator: profile.separator,
        separatorMinLength: prepared.separatorMinLength,
        grouping: profile.grouping,
        aliases: profile.aliases,
        permutation: { enabled: false },
        profanity: { mode: "none" },
        maxRepetition: 0
      },
      generations: Array.from({ length: maxGen - prepared.minLength + 1 }, (_, i) => prepared.minLength + i).map((l) => ({
        length: l,
        base: generationBase(prepared, l).toString(10),
        capacity: generationCapacity(prepared, l).toString(10)
      }))
    };
  }

  function pushRoundTrip(h: Baseh, id: bigint, note?: string): void {
    const canonical = h.encode(id);
    const rawCode = canonical.replaceAll("-", "");
    const bodyLength = rawCode.length - effectiveChecksumLength(h.profile, rawCode.length);
    codecVectors.push({
      profileId: h.profile.profileId,
      id: id.toString(10),
      canonicalCode: canonical,
      rawBody: rawCode.slice(0, bodyLength),
      rawChecksum: rawCode.slice(bodyLength),
      ...(note ? { note } : {})
    } as never);
  }

  // Zero-checksum window: checksumLength 2, short 0 through length 5. Round
  // trips at generations 4-6; window codes are all body (rawChecksum "").
  const short0 = shortTestProfile("short0-expandable-test", 0, 5);
  const hShort0 = new Baseh(short0);
  profileEntries.push(expandableEntry(short0, hShort0.profile, 6));
  for (const l of [4, 5, 6]) {
    pushRoundTrip(hShort0, generationBase(hShort0.profile, l), l <= 5 ? "zero-checksum generation: all body" : undefined);
    pushRoundTrip(hShort0, generationBase(hShort0.profile, l + 1) - 1n, l <= 5 ? "zero-checksum generation: all body" : undefined);
    pushRoundTrip(hShort0, generationBase(hShort0.profile, l) + 7n);
  }

  // Until-8 window: short 1 through length 8. Round trips at the 8/9
  // boundary pin effective K of 1 at length 8 and 2 at length 9.
  const short8 = shortTestProfile("short8-expandable-test", 1, 8);
  const hShort8 = new Baseh(short8);
  profileEntries.push(expandableEntry(short8, hShort8.profile, 9));
  pushRoundTrip(hShort8, generationBase(hShort8.profile, 9) - 1n, "last id of the until-8 window: one checksum symbol");
  pushRoundTrip(hShort8, generationBase(hShort8.profile, 9), "first id above the window: two checksum symbols");
  pushRoundTrip(hShort8, generationBase(hShort8.profile, 8) + 11n);
  pushRoundTrip(hShort8, generationBase(hShort8.profile, 9) + 11n);

  // Validation error vectors (spec 22.2 amended matrix).
  const invalidDefinitions: [string, BasehProfile][] = [
    ["until above 8", { ...shortTestProfile("bad-until-9", 1, 9) }],
    ["until below minLength", { ...shortTestProfile("bad-until-3", 1, 3) }],
    ["length without until", { ...shortTestProfile("bad-length-no-until", 1, 0) }],
    ["length >= checksumLength", { ...shortTestProfile("bad-length-2", 2, 5) }],
    ["fixed mode rejects the fields", { ...basehMediumV1(), shortChecksumLength: 1, shortChecksumUntil: 5 }]
  ];
  for (const [note, definition] of invalidDefinitions) {
    try {
      void new Baseh(definition);
      throw new Error(`profile-error vector generation broke: ${note}`);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== "INVALID_PROFILE") throw e;
    }
    const { permutation, ...rest } = definition;
    void permutation;
    profileErrors.push({
      note,
      error: "INVALID_PROFILE",
      definition: { ...rest, permutation: { enabled: false } }
    });
  }
}

// --- Spec 12.5 inspect vectors ------------------------------------------------
// State-machine vectors for live as-you-type inspection: input + profileId to
// the expected tagged state and its payload fields. Entries are generated by
// the reference implementation itself; the curated inputs pin every state on
// both a fixed tier (baseh-medium-v1) and the expandable tier.
const inspectVectors: unknown[] = [];
{
  function pushInspect(h: Baseh, input: string, note?: string): void {
    const r = h.inspect(input);
    const entry: Record<string, unknown> = { profileId: h.profile.profileId, input, state: r.state };
    if (r.state === "typing") {
      entry.typed = r.typed;
      entry.progress = r.progress;
    } else if (r.state === "invalid") {
      entry.reason = r.reason;
    } else if (r.state === "valid") {
      entry.id = r.id.toString(10);
      entry.canonicalCode = r.canonicalCode;
    }
    if (note) entry.note = note;
    inspectVectors.push(entry);
  }

  const hMedium = new Baseh(basehMediumV1());
  const canonicalM = hMedium.encode(123456789n);
  const rawM = canonicalM.replaceAll("-", "");
  pushInspect(hMedium, "");
  pushInspect(hMedium, "  - ", "whitespace-only and separator-only input is empty");
  for (let n = 1; n < 8; n += 1) {
    pushInspect(hMedium, rawM.slice(0, n), n === 1 ? "every proper prefix of a fixed code is typing" : undefined);
  }
  pushInspect(hMedium, canonicalM);
  pushInspect(hMedium, " " + rawM.toLowerCase() + " ", "case, whitespace and missing separators still reach valid");
  pushInspect(hMedium, "OIL", "aliases normalize while typing");
  {
    // Alias-typed complete code: find an id whose code contains 8, type B.
    for (let id = 1n; id < 100000n; id += 1n) {
      let c: string;
      try {
        c = hMedium.encode(id);
      } catch {
        continue; // blocklisted ids are reserved, skip them
      }
      const rawC = c.replaceAll("-", "");
      if (rawC.includes("8")) {
        pushInspect(hMedium, rawC.replace("8", "B"), "typed B aliases to 8 and reaches valid");
        break;
      }
    }
  }
  {
    const badCheck = rawM[6] === "2" ? "3" : "2";
    pushInspect(hMedium, rawM.slice(0, 6) + badCheck + rawM[7], "complete code with a wrong checksum");
  }
  pushInspect(hMedium, "12@");
  pushInspect(hMedium, "0000-0000-C");
  {
    // Spec 3.4 false green: a short input whose re-padded form validates.
    // The scan runs on a filter-free clone so the blocklist and repetition
    // filter cannot disturb it; the pinned input behaves identically on the
    // frozen tier because typing never consults encode-time filters.
    const clone = new Baseh({ ...basehMediumV1(), profanity: { mode: "none" }, maxRepetition: 0 });
    for (let id = 0n; id < 200000n; id += 1n) {
      const raw = clone.encode(id).replaceAll("-", "");
      const stripped = raw.replace(/^0+(?=.)/, "");
      if (stripped.length < raw.length && stripped.length >= 2 && clone.validate(stripped).valid) {
        pushInspect(hMedium, stripped, "spec 3.4: a padded prefix that would validate still reports typing");
        break;
      }
    }
  }

  const hExp = new Baseh(basehExpandableV1());
  pushInspect(hExp, "");
  pushInspect(hExp, "1");
  pushInspect(hExp, "12");
  pushInspect(hExp, "123");
  pushInspect(hExp, "O", "alias O -> 0 normalizes while typing; bare below separatorMinLength");
  const code4 = hExp.encode(0n);
  const code5 = hExp.encode(19683n);
  const code6 = hExp.encode(551124n);
  pushInspect(hExp, code4, "first id: generation 4, the first complete length");
  pushInspect(hExp, code5, "first id of generation 5");
  pushInspect(hExp, code6, "first id of generation 6, renders with a hyphen");
  const raw6 = code6.replaceAll("-", "");
  pushInspect(hExp, " " + raw6.slice(0, 3) + " - " + raw6.slice(3), "whitespace and separators are ignored");
  pushInspect(hExp, raw6.slice(0, 5), "a prefix of a longer code is a complete shorter code: never typing");
  const sampleE = hExp.encode(777n).replaceAll("-", "");
  pushInspect(hExp, sampleE + "A", "wrong-length presentation fails the checksum");
  pushInspect(hExp, "0" + sampleE.slice(1), "0 in a body position");
  pushInspect(hExp, "O" + sampleE.slice(1), "O aliases to 0, then fails in a body position");
  pushInspect(hExp, "A@");
  pushInspect(hExp, "ABCD@");
  pushInspect(hExp, "A".repeat(33));
  pushInspect(hExp, "A".repeat(32), "at the 32-symbol ceiling the input is complete, not too-long");
}

writeFileSync(
  new URL("../../vectors/vectors.json", import.meta.url),
  JSON.stringify(
    { version: "1", profiles: profileEntries, vectors: codecVectors, errors: errorVectors, correction: correctionVectors, encodeErrors, profileErrors, inspect: inspectVectors },
    null,
    2
  ) + "\n"
);
writeFileSync(
  new URL("../../vectors/feistel-vectors.json", import.meta.url),
  JSON.stringify({ version: "1", vectors: feistelVectors }, null, 2) + "\n"
);
console.log(`wrote ${codecVectors.length} codec vectors, ${feistelVectors.length} feistel vectors, ${inspectVectors.length} inspect vectors`);
