import { type BasehErrorCode } from "./errors.js";
import { type BasehProfile, type PreparedProfile } from "./profile.js";
export type ConfusionProfileName = "none" | "light" | "medium" | "heavy";
/** Built-in spoken-confusion candidate maps. Spec 3.3; pairs apply to body symbols only. */
export declare const CONFUSION_MAPS: Record<Exclude<ConfusionProfileName, "none">, Record<string, string[]>>;
export interface DecodeOptions {
    acceptSpaces?: boolean;
    tryCorrection?: boolean;
    confusionProfile?: ConfusionProfileName;
    maxCorrections?: 0 | 1;
}
export interface DecodeResult {
    id: bigint;
    canonicalCode: string;
    corrected: boolean;
}
export interface ValidateResult {
    valid: boolean;
    canonicalCode?: string;
    reason?: BasehErrorCode;
}
/** Spec 3.1 normalization, steps 1-7. Returns the raw unformatted string. */
export declare function normalize(input: string, profile: PreparedProfile, acceptSpaces?: boolean): string;
export declare function formatRaw(raw: string, profile: PreparedProfile): string;
/**
 * Spec 19.5. Group sizes for a total length under the right-anchored
 * repeating pattern: consume groups from the right, cycling the pattern from
 * its last element backwards; a short remainder forms the leftmost group.
 */
export declare function expandableGrouping(length: number, pattern: number[]): number[];
/**
 * Spec 19.1. First id of generation L: the sum of A^(k-K) for k from
 * minLength through L-1.
 */
export declare function generationBase(profile: PreparedProfile, length: number): bigint;
/** Spec 19.1. Ids held by generation L: A^(L-K). */
export declare function generationCapacity(profile: PreparedProfile, length: number): bigint;
/** Smallest generation whose range holds id, per spec 19.6. */
export declare function generationForId(profile: PreparedProfile, id: bigint): number;
/** Spec 10. Substitution-only candidate generation, capped and deduplicated. */
export declare function generateCandidates(body: string, confusionMap: Record<string, string[]>, maxEdits?: number): string[];
export declare class Baseh {
    readonly profile: PreparedProfile;
    private readonly bodyIndex;
    constructor(profile: BasehProfile);
    capacity(): bigint;
    private permKey;
    private checkBlocklist;
    /** Spec 8 (fixed mode). */
    private encodeFixed;
    /** Spec 19.6. */
    private encodeExpandable;
    /** Spec 8/19.6. */
    encode(id: bigint | number): string;
    /** Spec 9/19.7. */
    decode(input: string, options?: DecodeOptions): DecodeResult;
    /** Spec 12.4. Never throws on user input. */
    validate(input: string, options?: DecodeOptions): ValidateResult;
}
