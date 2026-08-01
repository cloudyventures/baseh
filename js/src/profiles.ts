import type { BasehProfile } from "./profile.js";

/**
 * Frozen tiers. Each is built from the full alphanumeric set with cumulative
 * visual and spoken strips; the spoken strips interact with the visual ones
 * exactly as the web tools derive them, so the tool capacities match.
 *
 *   Minimum  36 symbols, no checksum, XXX-XXX      2,176,782,336 ids
 *   Light    31 symbols, 2 checksums, XXXX-XXXX      887,503,681 ids
 *   Medium   28 symbols, 2 checksums, XXXX-XXXX      481,890,304 ids (default)
 *   Heavy    26 symbols, 2 checksums, XXXX-XXXX      308,915,776 ids
 *
 * All four keep the typed O/I/L aliases where possible, use a hyphen
 * delimiter at the midpoint and run the default profanity blocklist. Every
 * tier permutes with the frozen published key (FROZEN_KEY_BYTES below): the
 * key is public, so the permutation obscures sequence but is not secrecy.
 * The -p variants are identical but permute with caller-supplied key
 * material instead.
 */

const OIL_ALIASES = { O: "0", I: "1", L: "1" };

const MINIMUM_BODY = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LIGHT_BODY = "0123456789ABCEFGHJKMNPQRSUVWXYZ";
const MEDIUM_BODY = "0123456789ACDEFGHJKMPQRUVXYZ";
const HEAVY_BODY = "0123456789ABCEFHJKMPQRVXYZ";

const LIGHT_CHECK = "234679ACEFGHJKMNPQRUVWXY";
const MEDIUM_CHECK = "234679ACDEFGHJKMPQRUVXY";
const HEAVY_CHECK = "234679ACEFHJKMPQRUVXY";

/**
 * The frozen published permutation key. Public by design: it makes issued
 * codes look non-sequential but offers no secrecy, since anyone can read it
 * here. Never swap it on a live namespace; codes only decode with the key
 * they were issued under. Use the -p variants to supply private key material.
 */
export const FROZEN_KEY_BYTES: Uint8Array = new TextEncoder().encode("baseh-frozen-key-v1");

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
    mode: "fixed",
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
  checksumLength: 2,
  separator: "-",
  grouping: [4, 4],
  aliases: { ...OIL_ALIASES, D: "B", T: "P" }
};

const MEDIUM: TierShape = {
  profileId: "baseh-medium",
  bodyAlphabet: MEDIUM_BODY,
  checksumAlphabet: MEDIUM_CHECK,
  checksumLength: 2,
  separator: "-",
  grouping: [4, 4],
  // B and S are dropped for looking like 8 and 5; since they can never be
  // issued, a typed B is always an 8 and a typed S always a 5.
  aliases: { ...OIL_ALIASES, B: "8", S: "5", T: "P", N: "M", W: "V" }
};

const HEAVY: TierShape = {
  profileId: "baseh-heavy",
  bodyAlphabet: HEAVY_BODY,
  checksumAlphabet: HEAVY_CHECK,
  checksumLength: 2,
  separator: "-",
  grouping: [4, 4],
  aliases: { ...OIL_ALIASES, D: "B", T: "P", N: "M", W: "V", S: "F", G: "C" }
};

/** Permutation every plain tier applies, built from the frozen published key. */
function frozenPermutation(): BasehProfile["permutation"] {
  return keyedPermutation({ keyBytes: FROZEN_KEY_BYTES, keyId: "frozen" });
}

/** Alphanumeric, no safety strips, no checksum, hyphen-delimited XXX-XXX. */
export function basehMinimumV1(): BasehProfile {
  return tier(MINIMUM, frozenPermutation(), false);
}

/** baseh-minimum permuted with caller-supplied key material. */
export function basehMinimumPV1(options: FrozenKeyOptions): BasehProfile {
  return tier(MINIMUM, keyedPermutation(options), true);
}

/** Visual light plus spoken light, two checksum symbols, hyphen-delimited. */
export function basehLightV1(): BasehProfile {
  return tier(LIGHT, frozenPermutation(), false);
}

/** baseh-light permuted with caller-supplied key material. */
export function basehLightPV1(options: FrozenKeyOptions): BasehProfile {
  return tier(LIGHT, keyedPermutation(options), true);
}

/** Visual medium plus spoken medium, two checksum symbols, hyphen-delimited. The default. */
export function basehMediumV1(): BasehProfile {
  return tier(MEDIUM, frozenPermutation(), false);
}

/** baseh-medium permuted with caller-supplied key material. */
export function basehMediumPV1(options: FrozenKeyOptions): BasehProfile {
  return tier(MEDIUM, keyedPermutation(options), true);
}

/** Conservative alphabet plus spoken heavy, two checksum symbols, hyphen-delimited. */
export function basehHeavyV1(): BasehProfile {
  return tier(HEAVY, frozenPermutation(), false);
}

// Spec 17.1: "the full alphanumeric set minus 0 and O (34 symbols; the zero
// ban of section 19.2)". The JSON bodyAlphabet string printed in section
// 17.1 lists only 32 symbols (it also drops I and L), but the prose, the
// generation-capacity table (34^(L-2); 1,156 ids at length 4) and the
// checksum modulus (35^2 = 1,225) are all consistent only with 34, and the
// zero ban removes exactly 0 and O. The 34-symbol alphabet is the one that
// satisfies the normative numbers.
const EXPANDABLE_BODY = "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ";

/**
 * Spec 17.1. The frozen expandable tier: four characters while the namespace
 * is small, gaining one symbol automatically as issuance climbs past each
 * generation's capacity. The body alphabet is the full alphanumeric set
 * minus 0/O (the zero ban, spec 19.2); the checksum alphabet derives as "0"
 * plus the body (35 symbols, modulus 1225). The hyphen appears from six
 * characters up, split by the balanced grouping rule of spec 19.5.
 */
function expandableTier(permutation: BasehProfile["permutation"], pSuffix: boolean): BasehProfile {
  return {
    profileId: "baseh-expandable" + (pSuffix ? "-p" : "") + "-v1",
    mode: "expandable",
    bodyAlphabet: EXPANDABLE_BODY,
    minLength: 4,
    checksumAlphabet: "0" + EXPANDABLE_BODY,
    checksumLength: 2,
    caseSensitive: false,
    separator: "-",
    separatorMinLength: 6,
    grouping: [],
    aliases: { ...OIL_ALIASES, T: "P", N: "M", W: "V" },
    permutation,
    profanity: { mode: "blocklist" }
  };
}

/** The frozen expandable tier; the recommended starting point for new namespaces. */
export function basehExpandableV1(): BasehProfile {
  return expandableTier(frozenPermutation(), false);
}

/** baseh-expandable permuted with caller-supplied key material. */
export function basehExpandablePV1(options: FrozenKeyOptions): BasehProfile {
  return expandableTier(keyedPermutation(options), true);
}


/** baseh-heavy permuted with caller-supplied key material. */
export function basehHeavyPV1(options: FrozenKeyOptions): BasehProfile {
  return tier(HEAVY, keyedPermutation(options), true);
}
