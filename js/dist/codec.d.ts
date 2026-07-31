import { type HrcErrorCode } from "./errors.js";
import { type HrcProfile, type PreparedProfile } from "./profile.js";
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
    reason?: HrcErrorCode;
}
/** Spec 3.1 normalization, steps 1-7. Returns the raw unformatted string. */
export declare function normalize(input: string, profile: PreparedProfile, acceptSpaces?: boolean): string;
export declare function formatRaw(raw: string, profile: PreparedProfile): string;
/** Spec 10. Substitution-only candidate generation, capped and deduplicated. */
export declare function generateCandidates(body: string, confusionMap: Record<string, string[]>, maxEdits?: number): string[];
export declare class Hrc {
    readonly profile: PreparedProfile;
    private readonly bodyIndex;
    constructor(profile: HrcProfile);
    capacity(): bigint;
    /** Spec 8. */
    encode(id: bigint | number): string;
    /** Spec 9. */
    decode(input: string, options?: DecodeOptions): DecodeResult;
    /** Spec 12.4. Never throws on user input. */
    validate(input: string, options?: DecodeOptions): ValidateResult;
}
