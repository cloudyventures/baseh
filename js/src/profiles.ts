import type { BasehProfile } from "./profile.js";

/**
 * Frozen tiers. Each is built from the full alphanumeric set with cumulative
 * visual and spoken strips; the spoken strips interact with the visual ones
 * exactly as the web tools derive them, so the tool capacities match.
 *
 *   Minimum  36 symbols, no checksum           2,176,782,336 ids
 *   Light    31 symbols, 1 checksum              887,503,681 ids
 *   Medium   28 symbols, 1 checksum              481,890,304 ids (default)
 *   Heavy    26 symbols, 1 checksum              308,915,776 ids
 *
 * All four keep the typed O/I/L aliases where possible and run the default
 * profanity blocklist. Minimum also uses a hyphen delimiter; the rest have
 * none. The -p variants are identical but with feistel-v1 permutation and
 * require caller-supplied key material.
 */

const OIL_ALIASES = { O: "0", I: "1", L: "1" };

const MINIMUM_BODY = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LIGHT_BODY = "0123456789ABCEFGHJKMNPQRSUVWXYZ";
const MEDIUM_BODY = "0123456789ACDEFGHJKMPQRUVXYZ";
const HEAVY_BODY = "0123456789ABCEFHJKMPQRVXYZ";

const LIGHT_CHECK = "234679ACEFGHJKMNPQRUVWXY";
const MEDIUM_CHECK = "234679ACDEFGHJKMPQRUVXY";
const HEAVY_CHECK = "234679ACEFHJKMPQRUVXY";

export interface FrozenKeyOptions {
  keyBytes: Uint8Array;
  keyId?: string;
  rounds?: number;
}

function keyedPermutation(options: FrozenKeyOptions): BasehProfile["permutation"] {
  return {
    enabled: true,
    algorithm: "feistel-v1",
    keyId: options.keyId ?? "default",
    keyBytes: options.keyBytes,
    rounds: options.rounds ?? 8
  };
}

interface TierShape {
  profileId: string;
  bodyAlphabet: string;
  checksumAlphabet: string;
  checksumLength: number;
  separator: string;
  grouping: number[];
  aliases: Record<string, string>;
}

function tier(shape: TierShape, permutation: BasehProfile["permutation"], pSuffix: boolean): BasehProfile {
  return {
    profileId: shape.profileId + (pSuffix ? "-p" : "") + "-v1",
    bodyAlphabet: shape.bodyAlphabet,
    bodyLength: 6,
    checksumAlphabet: shape.checksumAlphabet,
    checksumLength: shape.checksumLength,
    caseSensitive: false,
    separator: shape.separator,
    grouping: shape.grouping,
    aliases: { ...shape.aliases },
    permutation,
    profanity: { mode: "blocklist" }
  };
}

const MINIMUM: TierShape = {
  profileId: "baseh-minimum",
  bodyAlphabet: MINIMUM_BODY,
  checksumAlphabet: "",
  checksumLength: 0,
  separator: "-",
  grouping: [3, 3],
  aliases: {}
};

const LIGHT: TierShape = {
  profileId: "baseh-light",
  bodyAlphabet: LIGHT_BODY,
  checksumAlphabet: LIGHT_CHECK,
  checksumLength: 1,
  separator: "",
  grouping: [],
  aliases: { ...OIL_ALIASES, D: "B", T: "P" }
};

const MEDIUM: TierShape = {
  profileId: "baseh-medium",
  bodyAlphabet: MEDIUM_BODY,
  checksumAlphabet: MEDIUM_CHECK,
  checksumLength: 1,
  separator: "",
  grouping: [],
  // B and S are dropped for looking like 8 and 5; since they can never be
  // issued, a typed B is always an 8 and a typed S always a 5.
  aliases: { ...OIL_ALIASES, B: "8", S: "5", T: "P", N: "M", W: "V" }
};

const HEAVY: TierShape = {
  profileId: "baseh-heavy",
  bodyAlphabet: HEAVY_BODY,
  checksumAlphabet: HEAVY_CHECK,
  checksumLength: 1,
  separator: "",
  grouping: [],
  aliases: { ...OIL_ALIASES, D: "B", T: "P", N: "M", W: "V", S: "F", G: "C" }
};

/** Alphanumeric, no safety strips, no checksum, hyphen-delimited XXX-XXX. */
export function basehMinimumV1(): BasehProfile {
  return tier(MINIMUM, { enabled: false }, false);
}

/** baseh-minimum with feistel-v1 permutation. */
export function basehMinimumPV1(options: FrozenKeyOptions): BasehProfile {
  return tier(MINIMUM, keyedPermutation(options), true);
}

/** Visual light plus spoken light, one checksum symbol. */
export function basehLightV1(): BasehProfile {
  return tier(LIGHT, { enabled: false }, false);
}

/** baseh-light with feistel-v1 permutation. */
export function basehLightPV1(options: FrozenKeyOptions): BasehProfile {
  return tier(LIGHT, keyedPermutation(options), true);
}

/** Visual medium plus spoken medium, one checksum symbol. The default. */
export function basehMediumV1(): BasehProfile {
  return tier(MEDIUM, { enabled: false }, false);
}

/** baseh-medium with feistel-v1 permutation. */
export function basehMediumPV1(options: FrozenKeyOptions): BasehProfile {
  return tier(MEDIUM, keyedPermutation(options), true);
}

/** Conservative alphabet plus spoken heavy, one checksum symbol. */
export function basehHeavyV1(): BasehProfile {
  return tier(HEAVY, { enabled: false }, false);
}

/** baseh-heavy with feistel-v1 permutation. */
export function basehHeavyPV1(options: FrozenKeyOptions): BasehProfile {
  return tier(HEAVY, keyedPermutation(options), true);
}
