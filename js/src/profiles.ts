import type { BasehProfile } from "./profile.js";

const BODY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CHECKSUM_ALPHABET = "234679ACDEFGHJKMNPQRTUVWXY";
const ALIASES = { O: "0", I: "1", L: "1" };

interface FrozenOptions {
  keyBytes: Uint8Array;
  keyId: string;
  rounds?: number;
}

/**
 * Frozen profile baseh32-v1: 6 body + 1 checksum, feistel-v1 permutation.
 * Assisted-support use. Structured single-substitution miss rate about 1.2%
 * per position; see spec 6.3.
 */
export function baseh32V1(options: FrozenOptions): BasehProfile {
  return {
    profileId: "baseh32-v1",
    bodyAlphabet: BODY_ALPHABET,
    bodyLength: 6,
    checksumAlphabet: CHECKSUM_ALPHABET,
    checksumLength: 1,
    caseSensitive: false,
    separator: "",
    grouping: [],
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
 * Frozen profile baseh32s-v1: 6 body + 2 checksum, feistel-v1 permutation.
 * Self-service use. Provably detects all single-symbol substitutions and
 * all adjacent transpositions; see spec 6.3.
 */
export function baseh32sV1(options: FrozenOptions): BasehProfile {
  const base = baseh32V1(options);
  return {
    ...base,
    profileId: "baseh32s-v1",
    checksumLength: 2
  };
}

/** Published demo key for the browser tools. Never use in a real application. */
export const DEMO_KEY_ID = "demo-01";
export const DEMO_KEY_BYTES = new TextEncoder().encode("BASEHUMAN-DEMO-KEY-01");
