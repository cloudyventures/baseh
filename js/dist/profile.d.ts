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
    /**
     * Spec 2.1/19.9. "fixed" keeps the classic constant-width behaviour;
     * "expandable" gives variable-length codes driven by id magnitude
     * (spec 19). Profiles that predate the mode field are fixed: the shared
     * frozen vectors pin their byte-for-byte behaviour, so a missing mode is
     * prepared as "fixed".
     */
    mode?: "fixed" | "expandable";
    bodyAlphabet: string;
    /** Fixed mode only; ignored in expandable mode. */
    bodyLength?: number;
    /** Expandable mode only; default 4. Must exceed checksumLength. */
    minLength?: number;
    checksumAlphabet: string;
    checksumLength: number;
    caseSensitive: boolean;
    separator: string;
    /** Expandable mode only; default 0 (separator always applies). */
    separatorMinLength?: number;
    grouping: number[];
    aliases: Record<string, string>;
    permutation: BasehPermutation;
    /** Spec 18. Defaults to mode "none". */
    profanity?: BasehProfanity;
}
/** Case-prepared derived data, computed once at construction. */
export interface PreparedProfile extends BasehProfile {
    readonly mode: "fixed" | "expandable";
    readonly minLength: number;
    readonly separatorMinLength: number;
    readonly bodyAlphabetNorm: string;
    readonly checksumAlphabetNorm: string;
    readonly aliasesNorm: Record<string, string>;
    readonly checksumModulus: bigint;
    /** Fixed-mode capacity A^bodyLength. Meaningless in expandable mode. */
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
