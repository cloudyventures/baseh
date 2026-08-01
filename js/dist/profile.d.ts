import { type BasehProfanity } from "./blocklist.js";
export type BasehPermutation = {
    enabled: false;
} | {
    enabled: true;
    algorithm: "feistel-v1";
    keyId: string;
    keyBytes: Uint8Array;
    rounds: number;
};
export interface BasehProfile {
    profileId: string;
    bodyAlphabet: string;
    bodyLength: number;
    checksumAlphabet: string;
    checksumLength: number;
    caseSensitive: boolean;
    separator: string;
    grouping: number[];
    aliases: Record<string, string>;
    permutation: BasehPermutation;
    /** Spec 18. Defaults to mode "none". */
    profanity?: BasehProfanity;
}
/** Case-prepared derived data, computed once at construction. */
export interface PreparedProfile extends BasehProfile {
    readonly bodyAlphabetNorm: string;
    readonly checksumAlphabetNorm: string;
    readonly aliasesNorm: Record<string, string>;
    readonly checksumModulus: bigint;
    readonly capacity: bigint;
    /** Spec 18. Empty unless the profile uses mode "blocklist". */
    readonly blocklist: string[];
}
/**
 * Validates a profile per spec section 2.2 and returns it with derived,
 * pre-computed values. Throws BasehError INVALID_PROFILE on any violation.
 * Call once at construction, never per encode/decode.
 */
export declare function prepareProfile(profile: BasehProfile): PreparedProfile;
