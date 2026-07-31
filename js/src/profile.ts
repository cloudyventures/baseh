import { HrcError } from "./errors.js";

export type HrcPermutation =
  | { enabled: false }
  | {
      enabled: true;
      algorithm: "feistel-v1";
      keyId: string;
      keyBytes: Uint8Array;
      rounds: number;
    };

export interface HrcProfile {
  profileId: string;
  bodyAlphabet: string;
  bodyLength: number;
  checksumAlphabet: string;
  checksumLength: number;
  caseSensitive: boolean;
  separator: string;
  grouping: number[];
  aliases: Record<string, string>;
  permutation: HrcPermutation;
}

/** Case-prepared derived data, computed once at construction. */
export interface PreparedProfile extends HrcProfile {
  readonly bodyAlphabetNorm: string;
  readonly checksumAlphabetNorm: string;
  readonly aliasesNorm: Record<string, string>;
  readonly checksumModulus: bigint;
  readonly capacity: bigint;
}

const ASCII_ONLY = /^[\x20-\x7e]*$/;

function fail(reason: string): never {
  throw new HrcError("INVALID_PROFILE", `Invalid HRC profile: ${reason}`, false);
}

function isAsciiChar(ch: string): boolean {
  return ch.length === 1 && ASCII_ONLY.test(ch);
}

function norm(profile: Pick<HrcProfile, "caseSensitive">, ch: string): string {
  return profile.caseSensitive ? ch : ch.toUpperCase();
}

function powBigInt(base: bigint, exp: number): bigint {
  let result = 1n;
  for (let i = 0; i < exp; i += 1) result *= base;
  return result;
}

/**
 * Validates a profile per spec section 2.2 and returns it with derived,
 * pre-computed values. Throws HrcError INVALID_PROFILE on any violation.
 * Call once at construction, never per encode/decode.
 */
export function prepareProfile(profile: HrcProfile): PreparedProfile {
  if (!profile || typeof profile !== "object") fail("profile is required");
  if (typeof profile.profileId !== "string" || profile.profileId.length === 0) {
    fail("profileId must be non-empty");
  }
  if (!ASCII_ONLY.test(profile.profileId)) fail("profileId must be ASCII");

  const caseSensitive = profile.caseSensitive === true;

  const bodyAlphabet = profile.bodyAlphabet;
  if (typeof bodyAlphabet !== "string" || bodyAlphabet.length < 2) {
    fail("bodyAlphabet needs at least two symbols");
  }
  for (const ch of bodyAlphabet) {
    if (!isAsciiChar(ch)) fail(`body alphabet symbol is not single ASCII: ${JSON.stringify(ch)}`);
  }
  const view = { caseSensitive };
  const bodyNorm = [...bodyAlphabet].map((c) => norm(view, c)).join("");
  if (new Set(bodyNorm).size !== bodyNorm.length) {
    fail("body alphabet symbols must be unique after case normalization");
  }

  if (
    !Number.isInteger(profile.bodyLength) ||
    profile.bodyLength < 1 ||
    profile.bodyLength > 32
  ) {
    fail("bodyLength must be an integer from 1 through 32");
  }
  if (
    !Number.isInteger(profile.checksumLength) ||
    profile.checksumLength < 0 ||
    profile.checksumLength > 8
  ) {
    fail("checksumLength must be an integer from 0 through 8");
  }

  const checksumAlphabet = profile.checksumAlphabet ?? "";
  if (profile.checksumLength > 0) {
    if (typeof checksumAlphabet !== "string" || checksumAlphabet.length < 2) {
      fail("checksumAlphabet needs at least two symbols when checksumLength is positive");
    }
    for (const ch of checksumAlphabet) {
      if (!isAsciiChar(ch)) fail(`checksum alphabet symbol is not single ASCII: ${JSON.stringify(ch)}`);
    }
  }
  const checksumNorm = [...checksumAlphabet].map((c) => norm(view, c)).join("");
  if (new Set(checksumNorm).size !== checksumNorm.length) {
    fail("checksum alphabet symbols must be unique after case normalization");
  }

  const separator = profile.separator ?? "";
  for (const ch of separator) {
    if (bodyNorm.includes(ch) || checksumNorm.includes(ch)) {
      fail("separator must not occur in either alphabet");
    }
  }

  const aliases = profile.aliases ?? {};
  const aliasesNorm: Record<string, string> = {};
  const canonicalSet = new Set([...bodyNorm, ...checksumNorm]);
  for (const [src, tgt] of Object.entries(aliases)) {
    if (!isAsciiChar(src)) fail(`alias source is not single ASCII: ${JSON.stringify(src)}`);
    if (!isAsciiChar(tgt)) fail(`alias target is not single ASCII: ${JSON.stringify(tgt)}`);
    const sNorm = norm(view, src);
    const tNorm = norm(view, tgt);
    if (canonicalSet.has(sNorm)) {
      fail(`alias source ${JSON.stringify(src)} is already a canonical symbol`);
    }
    if (!canonicalSet.has(tNorm)) {
      fail(`alias target ${JSON.stringify(tgt)} is not a canonical symbol`);
    }
    if (sNorm in aliasesNorm) fail(`duplicate alias source ${JSON.stringify(sNorm)} after case normalization`);
    if (tNorm in aliases || [...Object.keys(aliases)].some((k) => norm(view, k) === tNorm)) {
      fail(`alias chain forbidden: target ${tNorm} is also an alias source`);
    }
    aliasesNorm[sNorm] = tNorm;
  }

  const total = bodySum(profile.grouping);
  if (total !== profile.bodyLength + profile.checksumLength) {
    fail("group sizes must sum to bodyLength + checksumLength");
  }

  const permutation = profile.permutation ?? { enabled: false };
  if (permutation.enabled) {
    if (permutation.algorithm !== "feistel-v1") fail("unknown permutation algorithm");
    if (typeof permutation.keyId !== "string" || permutation.keyId.length === 0) {
      fail("permutation requires a keyId");
    }
    if (!(permutation.keyBytes instanceof Uint8Array) || permutation.keyBytes.length === 0) {
      fail("permutation requires key material");
    }
    if (
      !Number.isInteger(permutation.rounds) ||
      permutation.rounds < 4 ||
      permutation.rounds > 16 ||
      permutation.rounds % 2 !== 0
    ) {
      fail("Feistel rounds must be an even integer from 4 through 16");
    }
  }

  return {
    ...profile,
    caseSensitive,
    checksumAlphabet,
    separator,
    grouping: [...profile.grouping],
    aliases: { ...aliases },
    permutation,
    bodyAlphabetNorm: bodyNorm,
    checksumAlphabetNorm: checksumNorm,
    aliasesNorm,
    checksumModulus: powBigInt(BigInt(checksumNorm.length || 1), profile.checksumLength),
    capacity: powBigInt(BigInt(bodyNorm.length), profile.bodyLength)
  };
}

function bodySum(grouping: number[]): number {
  if (!Array.isArray(grouping)) return -1;
  let sum = 0;
  for (const g of grouping) {
    if (!Number.isInteger(g) || g < 1) return -1;
    sum += g;
  }
  return sum;
}
