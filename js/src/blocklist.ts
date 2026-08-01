import { BasehError } from "./errors.js";

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
export const DEFAULT_BLOCKLIST: readonly string[] = [
  "CRAP", "TWAT", "SHAG", "DAMN", "FCK", "FUC",
  "SHT", "CNT", "TWT", "DCK", "AZZ", "BCH"
];

const WORD = /^[A-Za-z]{2,32}$/;

function fail(reason: string): never {
  throw new BasehError("INVALID_PROFILE", `Invalid BaseH profile: ${reason}`, false);
}

/** Spec 18.2: replacement semantics, then augmentation, uppercased and deduplicated. */
export function effectiveBlocklist(profanity: BasehProfanity): string[] {
  const base = profanity.words ? [...profanity.words] : [...DEFAULT_BLOCKLIST];
  const list = [...base, ...(profanity.extraWords ?? [])];
  const out: string[] = [];
  for (const word of list) {
    if (typeof word !== "string" || !WORD.test(word)) {
      fail("blocklist entries must be 2 through 32 ASCII letters");
    }
    const upper = word.toUpperCase();
    if (!out.includes(upper)) out.push(upper);
  }
  return out;
}

/** Spec 18.1: vowels removed for no-vowels mode, applied after case normalization. */
export function stripVowels(alphabetNorm: string): string {
  return [...alphabetNorm].filter((c) => !"AEIOU".includes(c)).join("");
}
