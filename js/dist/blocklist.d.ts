export type BasehProfanityMode = "none" | "no-vowels" | "blocklist";
/** Spec 18. Optional profanity safety configuration. */
export interface BasehProfanity {
    mode: BasehProfanityMode;
    /** Replaces the default list when present (mode "blocklist" only). */
    words?: string[];
    /** Appended to the effective list (mode "blocklist" only). */
    extraWords?: string[];
}
/** Spec 18.2 default list. Deliberately small; applications extend it. */
export declare const DEFAULT_BLOCKLIST: readonly string[];
/** Spec 18.2: replacement semantics, then augmentation, uppercased and deduplicated. */
export declare function effectiveBlocklist(profanity: BasehProfanity): string[];
/** Spec 18.1: vowels removed for no-vowels mode, applied after case normalization. */
export declare function stripVowels(alphabetNorm: string): string;
