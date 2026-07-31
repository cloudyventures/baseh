export type HrcPermutation = {
    enabled: false;
} | {
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
/**
 * Validates a profile per spec section 2.2 and returns it with derived,
 * pre-computed values. Throws HrcError INVALID_PROFILE on any violation.
 * Call once at construction, never per encode/decode.
 */
export declare function prepareProfile(profile: HrcProfile): PreparedProfile;
