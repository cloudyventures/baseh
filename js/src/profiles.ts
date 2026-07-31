import type { HrcProfile } from "./profile.js";

const BODY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CHECKSUM_ALPHABET = "234679ACDEFGHJKMNPQRTUVWXY";
const ALIASES = { O: "0", I: "1", L: "1" };

interface FrozenOptions {
  keyBytes: Uint8Array;
  keyId: string;
  rounds?: number;
}

/**
 * Frozen profile hrc32-v1: 6 body + 1 checksum, feistel-v1 permutation.
 * Assisted-support use. Structured single-substitution miss rate about 1.2%
 * per position; see spec 6.3.
 */
export function hrc32V1(options: FrozenOptions): HrcProfile {
  return {
    profileId: "hrc32-v1",
    bodyAlphabet: BODY_ALPHABET,
    bodyLength: 6,
    checksumAlphabet: CHECKSUM_ALPHABET,
    checksumLength: 1,
    caseSensitive: false,
    separator: "-",
    grouping: [3, 3, 1],
    aliases: { ...ALIASES },
    permutation: {
      enabled: true,
      algorithm: "feistel-v1",
      keyId: options.keyId,
      keyBytes: options.keyBytes,
      rounds: options.rounds ?? 8
    }
  };
}

/**
 * Frozen profile hrc32s-v1: 6 body + 2 checksum, feistel-v1 permutation.
 * Self-service use. Provably detects all single-symbol substitutions and
 * all adjacent transpositions; see spec 6.3.
 */
export function hrc32sV1(options: FrozenOptions): HrcProfile {
  const base = hrc32V1(options);
  return {
    ...base,
    profileId: "hrc32s-v1",
    checksumLength: 2,
    grouping: [3, 3, 2]
  };
}

/** Published demo key for the browser tools. Never use in a real application. */
export const DEMO_KEY_ID = "demo-01";
export const DEMO_KEY_BYTES = new TextEncoder().encode("BASEHUMAN-DEMO-KEY-01");
