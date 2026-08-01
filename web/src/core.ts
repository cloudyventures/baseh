/**
 * Shared math for the calculator and designer. No DOM access.
 * Capacity math is exact bigint; ratios are display-only Numbers.
 */
import { Baseh, BasehError, FROZEN_KEY_BYTES, type BasehProfile } from "@cloudyventures/baseh";

export type AlphabetMode = "digits" | "upper" | "alnum" | "custom";
export type CodecMode = "fixed" | "expandable";
export type SafetyLevel = "none" | "light" | "medium" | "heavy";
export type ProfanityMode = "none" | "no-vowels" | "blocklist";

/**
 * Parse a required-capacity field: plain digits, grouped digits
 * ("60,000,000") or a compact suffix ("6k", "2.5m", "6b", "6t").
 * Returns null for anything that does not parse to an integer >= 1.
 */
export function parseRequired(raw: string): bigint | null {
  const cleaned = raw.replace(/[,_\s]/g, "");
  const m = cleaned.match(/^(\d+)(?:\.(\d+))?([kmgbt])?$/i);
  if (!m) return null;
  const intPart = m[1]!;
  const fracPart = m[2] ?? "";
  const suffixExp = { k: 3, m: 6, g: 9, b: 9, t: 12 }[m[3]?.toLowerCase() ?? ""] ?? 0;
  const digits = BigInt(intPart + fracPart);
  const shift = suffixExp - fracPart.length;
  let value: bigint;
  if (shift >= 0) {
    value = digits * 10n ** BigInt(shift);
  } else {
    const divisor = 10n ** BigInt(-shift);
    value = (digits + divisor / 2n) / divisor; // round half up
  }
  if (digits > 0n && value < 1n) value = 1n;
  return value < 1n ? null : value;
}

export const SAFE_BODY = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const SAFE_CHECKSUM = "234679ACDEFGHJKMNPQRTUVWXY";
const DIGITS = "0123456789";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const CATALOG_VERSION = "1";
export const SCORING_VERSION = "1";
export const DESIGNER_VERSION = "1";

/**
 * Preview key: the published frozen tier key, so the tools render exactly
 * what the libraries produce. It is public by design (spec 7.5) and hides
 * sequence only; a real application that wants secrecy generates its own
 * key and never ships it to a browser.
 */
export const PREVIEW_KEY_ID = "frozen";
export const PREVIEW_KEY_BYTES = FROZEN_KEY_BYTES;

function previewPermutation(on: boolean): BasehProfile["permutation"] {
  if (!on) return { enabled: false };
  return { enabled: true, algorithm: "feistel-v1", keyId: PREVIEW_KEY_ID, keyBytes: PREVIEW_KEY_BYTES, rounds: 8 };
}

export interface CalculatorInput {
  namespace: string;
  codecMode: CodecMode;
  alphabetMode: AlphabetMode;
  customAlphabet: string;
  visualSafety: SafetyLevel;
  spokenSafety: SafetyLevel;
  profanity: ProfanityMode;
  bodyLength: number;
  /** Expandable mode only; the length codes start at (default 4). */
  minLength: number;
  /** Expandable mode only; the separator appears from this total length up. */
  separatorMinLength: number;
  checksumLength: number;
  permutation: boolean;
  separator: string;
  /** Spec 21. 0 disables the repetition filter; otherwise at least 3. */
  maxRepetition: number;
  prefix: string;
  suffix: string;
  recordsPerDay?: bigint;
  retentionDays?: bigint;
  peakMultiplier: number;
  safetyMargin: number;
}

/**
 * Spoken safety pairs, ordered by how common the sound-alike confusion is.
 * Light holds the most common pairs, heavy the least. For each pair the second
 * symbol is stripped from every generation alphabet and aliased back to the
 * first on input, so a misheard letter decodes automatically. Levels are
 * cumulative: medium includes light pairs, heavy includes all.
 */
export const SPOKEN_PAIRS: Record<Exclude<SafetyLevel, "none">, Array<[string, string]>> = {
  light: [["B", "D"], ["P", "T"]],
  medium: [["M", "N"], ["V", "W"]],
  heavy: [["F", "S"], ["C", "G"]]
};

export function spokenPairsThrough(level: SafetyLevel): Array<[string, string]> {
  if (level === "none") return [];
  const pairs = [...SPOKEN_PAIRS.light];
  if (level === "medium" || level === "heavy") pairs.push(...SPOKEN_PAIRS.medium);
  if (level === "heavy") pairs.push(...SPOKEN_PAIRS.heavy);
  return pairs;
}

/** A pair applies only when the alphabet can actually emit the kept symbol. */
function spokenPairsFor(alphabet: string, spoken: SafetyLevel): Array<[string, string]> {
  return spokenPairsThrough(spoken).filter(([keep]) => alphabet.includes(keep));
}

export function applySpoken(alphabet: string, spoken: SafetyLevel): string {
  const drops = new Set(spokenPairsFor(alphabet, spoken).map(([, drop]) => drop));
  return [...alphabet].filter((c) => !drops.has(c)).join("");
}

/** Symbols that act as alias sources under the visual safety drops. */
const LOOKALIKE_SOURCES: ReadonlySet<string> = new Set(["O", "I", "L", "B", "S", "U"]);

/**
 * Checksum alphabet with the spoken drops removed, and with any alias
 * source that no longer appears in the body removed too. Alias sources must
 * stay non-canonical in every region of the code, or profile preparation
 * rejects the profile. SAFE_CHECKSUM already excludes O, I, L, B and S, so
 * the only alias source this ever removes is U (dropped at visual heavy).
 * Symbols absent from the body for other reasons are retained: the checksum
 * alphabet deliberately differs from the body alphabet.
 */
export function deriveChecksumAlphabet(bodyAlphabet: string, spoken: SafetyLevel, profanity: ProfanityMode = "none"): string {
  const drops = new Set(spokenPairsFor(bodyAlphabet, spoken).map(([, drop]) => drop));
  const inBody = new Set(bodyAlphabet);
  return applyProfanity(
    [...SAFE_CHECKSUM].filter((c) => !drops.has(c) && (inBody.has(c) || !LOOKALIKE_SOURCES.has(c))).join(""),
    profanity
  );
}

/** Spec 18 no-vowels mode: vowels are removed from every alphabet. */
export function applyProfanity(alphabet: string, profanity: ProfanityMode): string {
  if (profanity !== "no-vowels") return alphabet;
  return [...alphabet].filter((c) => !"AEIOU".includes(c)).join("");
}

/**
 * Look-alike aliases for every symbol the visual safety levels can strip:
 * O/I/L (light), B/S (medium) and U (heavy). Each stripped symbol can never
 * appear in an issued code, so seeing one always means its surviving twin.
 * Kept only when the target exists in the alphabet and the source does not;
 * the targets (digits and V) are never themselves alias sources, so chains
 * cannot form and every substitution is unambiguous.
 */
export function baseAliases(alphabet: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [src, tgt] of [["O", "0"], ["I", "1"], ["L", "1"], ["B", "8"], ["S", "5"], ["U", "V"]]) {
    if (alphabet.includes(tgt) && !alphabet.includes(src)) out[src] = tgt;
  }
  return out;
}

/** Aliases that map each stripped symbol back to the kept member of its pair. */
export function spokenAliases(bodyAlphabet: string, spoken: SafetyLevel): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [keep, drop] of spokenPairsFor(bodyAlphabet, spoken)) out[drop] = keep;
  return out;
}

/**
 * One-line explanation of what a visual safety level removes, comparing the
 * alphabet before and after the drops. Removed symbols that survive as
 * typed aliases are shown with what they read as; removed symbols with no
 * surviving twin are listed plain. Heavy is special: it replaces the
 * alphabet with the reviewed 32-symbol set rather than adding drops, so
 * B and S (dropped at medium) come back and the line says so.
 */
export function visualDropsExplainer(before: string, after: string, level: SafetyLevel): string {
  if (level === "heavy") {
    const removed = [...before].filter((c) => !after.includes(c));
    const aliases = baseAliases(after);
    const drops = removed.map((c) => (aliases[c] ? `${c} (read as ${aliases[c]})` : c)).join(", ");
    const added = [...after].filter((c) => !before.includes(c));
    const grows = added.length > 0
      ? ` ${/[0-9]/.test(added.join(""))
          ? /[A-Z]/.test(added.join(""))
            ? "Digits and letters are added to reach it."
            : "Digits are added to reach it."
          : "Letters are added to reach it."}`
      : "";
    const dropPart = drops ? `removes ${drops}; ` : "";
    return `Restricts to the reviewed 32-symbol alphabet, its own alphabet rather than a further drop from medium: ${dropPart}B, S and W remain in the alphabet.${grows}`;
  }
  const removed = [...before].filter((c) => !after.includes(c));
  if (removed.length === 0) return "No visual drops apply with the current alphabet.";
  const aliases = baseAliases(after);
  return `Removes from the alphabet: ${removed.map((c) => (aliases[c] ? `${c} (read as ${aliases[c]})` : c)).join(", ")}.`;
}

/**
 * One-line explanation of what a spoken safety level removes, given the
 * alphabet before the spoken drops. Returns "" when the level is "none".
 */
export function spokenDropsExplainer(preSpoken: string, spoken: SafetyLevel): string {
  if (spoken === "none") return "";
  const pairs = spokenPairsFor(preSpoken, spoken);
  if (pairs.length === 0) return "No spoken drops apply with the current safety settings.";
  return `Removes from the alphabet: ${pairs.map(([keep, drop]) => `${drop} (read as ${keep})`).join(", ")}.`;
}

export interface TryItem {
  /** What to try, in words ("change case"). */
  label: string;
  /** The sample code mutated accordingly; absent for prose-only items. */
  code?: string;
}

/**
 * Suggestions for poking at a Code converter under the current profile.
 * The first item summarises every alias substitution the configuration
 * admits ("substitutions: O for 0, I for 1") and the rest are single
 * clicks: case change, delimiter removal or insertion, a stray space,
 * a stripped leading zero, a guaranteed checksum failure and, when the
 * alphabet keeps both partners of a sound-alike pair, a mistyped
 * character the decoder amends. Correction chips are verified against
 * the codec at build time, so each one genuinely demonstrates an amended
 * code when a codec is supplied.
 */
export function trySuggestions(profile: BasehProfile, sample: string | null, codec?: Baseh): TryItem[] {
  const items: TryItem[] = [];
  const aliases = Object.entries(profile.aliases ?? {});
  if (aliases.length > 0) {
    items.push({ label: `substitutions: ${aliases.map(([src, tgt]) => `${src} for ${tgt}`).join(", ")}` });
  }
  if (!sample) return items;
  items.push({ label: "change case", code: sample.toLowerCase() });
  if (profile.separator) {
    if (sample.includes(profile.separator)) {
      items.push({ label: "remove the delimiters", code: sample.replaceAll(profile.separator, "") });
      items.push({ label: "add a delimiter", code: sample.slice(0, 2) + profile.separator + sample.slice(2) });
    } else {
      const cut = Math.max(1, Math.floor(sample.length / 2));
      items.push({ label: "add a delimiter", code: sample.slice(0, cut) + profile.separator + sample.slice(cut) });
    }
  }
  {
    const cut = Math.max(1, Math.floor(sample.length / 2));
    items.push({ label: "add spaces", code: `${sample.slice(0, cut)} ${sample.slice(cut)}` });
  }
  // Expandable codes are never left-padded, so there is no leading run of
  // the zero symbol to strip.
  const zero = profile.bodyAlphabet[0]!;
  if (profile.mode !== "expandable" && sample.startsWith(zero)) {
    const stripped = sample.replace(new RegExp(`^${zero}+`), "");
    if (stripped.length >= Math.max(profile.checksumLength, 1)) {
      items.push({ label: "strip the leading zero symbols", code: stripped });
    }
  }
  if (profile.checksumLength > 0) {
    if (codec) {
      // Sound-alike pairs keep both members canonical exactly when the
      // alphabet still contains the dropped partner, so mistyping one as
      // the other fails the checksum and the decoder must amend it.
      const pairs = [...SPOKEN_PAIRS.light, ...SPOKEN_PAIRS.medium, ...SPOKEN_PAIRS.heavy];
      for (const [keep, drop] of pairs) {
        if (!profile.bodyAlphabet.includes(keep) || !profile.bodyAlphabet.includes(drop)) continue;
        for (const [from, to] of [[keep, drop], [drop, keep]] as Array<[string, string]>) {
          const idx = sample.indexOf(from);
          if (idx < 0) continue;
          const mutated = sample.slice(0, idx) + to + sample.slice(idx + 1);
          try {
            const decoded = codec.decode(mutated, { tryCorrection: true, confusionProfile: "heavy" });
            if (decoded.corrected) {
              items.push({ label: `mistype ${from} as ${to} (the decoder corrects it)`, code: mutated });
              break;
            }
          } catch {
            // Ambiguous or rejected: not a clean demonstration, skip it.
          }
        }
      }
    }
    const last = sample[sample.length - 1];
    const replacement = [...profile.checksumAlphabet].find((c) => c !== last);
    if (replacement) {
      items.push({ label: "change the last character (breaks the checksum)", code: sample.slice(0, -1) + replacement });
    }
  } else {
    items.push({ label: "no checksum here: a typo silently decodes to a different identifier" });
  }
  return items;
}

export function deriveAlphabet(mode: AlphabetMode, custom: string, visual: SafetyLevel, spoken: SafetyLevel = "none", profanity: ProfanityMode = "none"): string {
  if (visual === "heavy") return applyProfanity(applySpoken(SAFE_BODY, spoken), profanity);
  let base: string;
  if (mode === "custom") {
    base = custom.toUpperCase().replace(/\s+/g, "");
  } else if (mode === "digits") base = DIGITS;
  else if (mode === "upper") base = UPPER;
  else base = DIGITS + UPPER;
  let chars = [...new Set(base)];
  const hasDigits = chars.some((c) => DIGITS.includes(c));
  if (hasDigits && (visual === "light" || visual === "medium")) {
    chars = chars.filter((c) => !"OIL".includes(c));
  }
  if (hasDigits && visual === "medium") {
    chars = chars.filter((c) => c !== "B" && c !== "S");
  }
  return applyProfanity(applySpoken(chars.join(""), spoken), profanity);
}

/**
 * Spec 19.2. The expandable body alphabet is the fixed-mode derivation with
 * the zero ban applied on top: 0 and O are silently removed from whatever
 * the alphabet modes, safety levels and profanity mode produced, custom
 * alphabets included.
 */
export function deriveExpandableBodyAlphabet(mode: AlphabetMode, custom: string, visual: SafetyLevel, spoken: SafetyLevel = "none", profanity: ProfanityMode = "none"): string {
  return [...deriveAlphabet(mode, custom, visual, spoken, profanity)].filter((c) => c !== "0" && c !== "O").join("");
}

/** Spec 19.3. The expandable checksum alphabet is derived, never configured: "0" followed by the body alphabet. */
export function deriveExpandableChecksumAlphabet(bodyAlphabet: string): string {
  return "0" + bodyAlphabet;
}

/**
 * Spec 19.5. Balanced grouping: the split is a pure function of the total
 * length — `g = max(2, ceil(L / 5))` groups differing in size by at most
 * one, larger groups to the left. There is no configurable pattern in
 * expandable mode (`grouping` must be empty, section 2.2).
 */
export function expandableGrouping(length: number): number[] {
  const g = Math.max(2, Math.ceil(length / 5));
  const base = Math.floor(length / g);
  if (base < 1) return [length];
  const rem = length % g;
  return [
    ...Array<number>(rem).fill(base + 1),
    ...Array<number>(g - rem).fill(base)
  ];
}

/** Spec 19.5. Displayed length of an expandable code; the separator appears only from separatorMinLength up. */
export function expandableDisplayedLength(totalLen: number, separator: string, separatorMinLength: number): number {
  if (!separator || totalLen < separatorMinLength) return totalLen;
  return totalLen + expandableGrouping(totalLen).length - 1;
}

/** Spec 19.1. Ids held by generation `length`: A^(length - checksumLength). */
export function generationCapacityAt(alphabetSize: number, checksumLength: number, length: number): bigint {
  return powBigInt(BigInt(alphabetSize), length - checksumLength);
}

/** Spec 19.1. Total ids held by every generation from minLength through `length`. */
export function generationCumulative(alphabetSize: number, checksumLength: number, minLength: number, length: number): bigint {
  let total = 0n;
  for (let l = minLength; l <= length; l += 1) total += generationCapacityAt(alphabetSize, checksumLength, l);
  return total;
}

export interface GenerationRow {
  length: number;
  capacity: bigint;
  cumulative: bigint;
}

/** The per-generation capacity table, from minLength through `rows` generations. */
export function generationTable(alphabetSize: number, checksumLength: number, minLength: number, rows: number): GenerationRow[] {
  const out: GenerationRow[] = [];
  let cumulative = 0n;
  for (let l = minLength; l < minLength + rows; l += 1) {
    const capacity = generationCapacityAt(alphabetSize, checksumLength, l);
    cumulative += capacity;
    out.push({ length: l, capacity, cumulative });
  }
  return out;
}

/** Spec 19.6. The smallest generation whose cumulative range holds `id`. */
export function generationForDemand(alphabetSize: number, checksumLength: number, minLength: number, id: bigint): number {
  let l = minLength;
  let cumulative = generationCapacityAt(alphabetSize, checksumLength, l);
  while (id >= cumulative) {
    l += 1;
    cumulative += generationCapacityAt(alphabetSize, checksumLength, l);
  }
  return l;
}

export function powBigInt(base: bigint, exp: number): bigint {
  if (base < 0n || exp < 0) throw new Error("invalid exponentiation input");
  let result = 1n;
  let factor = base;
  let power = exp;
  while (power > 0) {
    if (power % 2 === 1) result *= factor;
    power = Math.floor(power / 2);
    if (power > 0) factor *= factor;
  }
  return result;
}

export interface CalculatorResult {
  valid: boolean;
  problems: string[];
  alphabet: string;
  capacity: bigint;
  displayedCombinations: bigint;
  bits: string;
  maxId: bigint | null;
  required: bigint | null;
  utilization: number | null;
  utilizationStatus: "none" | "green" | "amber" | "red" | "invalid";
  lifetimeDays: bigint | null;
  checksumStates: bigint;
  falseAcceptance: string;
  displayedLength: number;
  /** Expandable mode: the per-generation capacity table; null in fixed mode. */
  generations: GenerationRow[] | null;
  /** Expandable mode: the generation the required demand lands in; null otherwise. */
  requiredGeneration: number | null;
  examples: Array<{ id: string; code: string; blocked?: boolean }>;
}

/** The live-preview profile the calculator samples with, or null when the
 * configuration is invalid (alphabet smaller than two symbols). */
export function calculatorProfile(input: CalculatorInput): BasehProfile | null {
  if (input.codecMode === "expandable") {
    const body = deriveExpandableBodyAlphabet(input.alphabetMode, input.customAlphabet, input.visualSafety, input.spokenSafety, input.profanity);
    if (body.length < 2) return null;
    // The checksum alphabet is derived by the codec ("0" + body, spec 19.3);
    // aliases are computed against the full canonical set so a typed O still
    // reads as the checksum-only 0.
    const canonical = deriveExpandableChecksumAlphabet(body);
    return {
      profileId: "ui-preview",
      mode: "expandable",
      bodyAlphabet: body,
      minLength: input.minLength,
      checksumAlphabet: canonical,
      checksumLength: input.checksumLength,
      caseSensitive: false,
      separator: input.separator,
      separatorMinLength: input.separatorMinLength,
      grouping: [],
      aliases: { ...baseAliases(canonical), ...spokenAliases(body, input.spokenSafety) },
      profanity: { mode: input.profanity },
      permutation: previewPermutation(input.permutation),
      maxRepetition: input.maxRepetition
    };
  }
  const alphabet = deriveAlphabet(input.alphabetMode, input.customAlphabet, input.visualSafety, input.spokenSafety, input.profanity);
  if (alphabet.length < 2) return null;
  const totalLen = input.bodyLength + input.checksumLength;
  return {
    profileId: "ui-preview",
    bodyAlphabet: alphabet,
    bodyLength: input.bodyLength,
    checksumAlphabet: deriveChecksumAlphabet(alphabet, input.spokenSafety, input.profanity),
    checksumLength: input.checksumLength,
    caseSensitive: false,
    separator: input.separator,
    grouping: input.separator ? groupingFor(totalLen) : [],
    aliases: { ...baseAliases(alphabet), ...spokenAliases(alphabet, input.spokenSafety) },
    profanity: { mode: input.profanity },
    permutation: previewPermutation(input.permutation),
    maxRepetition: input.maxRepetition
  };
}

/** A plain-language explanation for the converter fields, keyed off the
 * codec's machine error codes. */
export function friendlyError(e: unknown): string {
  if (e instanceof BasehError) {
    switch (e.code) {
      case "BLOCKED_CODE": return "blocked: this identifier is never issued (profanity or a long repetition run)";
      case "OUT_OF_RANGE": return "outside this configuration's capacity";
      case "INVALID_CHECKSUM": return "the checksum does not validate";
      case "INVALID_LENGTH": return "the wrong number of characters";
      case "INVALID_CHARACTER": return "contains characters outside this alphabet";
      case "AMBIGUOUS_INPUT": return "matches more than one possible correction";
      default: return `not a valid code (${e.code.toLowerCase().replaceAll("_", " ")})`;
    }
  }
  return "invalid input";
}

export function calculate(input: CalculatorInput): CalculatorResult {
  if (input.codecMode === "expandable") return calculateExpandable(input);
  const problems: string[] = [];
  const alphabet = deriveAlphabet(input.alphabetMode, input.customAlphabet, input.visualSafety, input.spokenSafety, input.profanity);
  const checksumAlphabet = deriveChecksumAlphabet(alphabet, input.spokenSafety, input.profanity);
  if (alphabet.length < 2) problems.push("Alphabet needs at least two symbols.");
  if (new Set(alphabet.toUpperCase()).size !== alphabet.length) {
    problems.push("Alphabet has duplicate symbols after case normalization.");
  }
  if (/[^\x20-\x7e]/.test(alphabet)) problems.push("Alphabet must be ASCII in version 1.");
  if (input.bodyLength < 1 || input.bodyLength > 32) problems.push("Body length must be 1 through 32.");
  if (input.checksumLength < 0 || input.checksumLength > 8) problems.push("Checksum length must be 0 through 8.");
  for (const ch of input.separator + input.prefix + input.suffix) {
    if (alphabet.includes(ch) || checksumAlphabet.includes(ch)) {
      problems.push(`Separator or affix "${ch}" collides with an alphabet.`);
      break;
    }
  }

  const capacity = powBigInt(BigInt(Math.max(alphabet.length, 1)), input.bodyLength);
  const checksumStates = powBigInt(BigInt(checksumAlphabet.length), input.checksumLength);
  const displayedCombinations = capacity * checksumStates;
  const bits = (input.bodyLength * Math.log2(Math.max(alphabet.length, 2))).toFixed(1);

  let required: bigint | null = null;
  if (input.recordsPerDay !== undefined && input.retentionDays !== undefined) {
    if (input.recordsPerDay < 0n || input.retentionDays < 0n) {
      problems.push("Demand values must not be negative.");
    } else {
      const exact = input.recordsPerDay * input.retentionDays;
      // Peak and margin are coarse planning factors; Number precision is
      // acceptable here and the result is a planning estimate, not a limit.
      const scaled = Number(exact) * input.peakMultiplier * input.safetyMargin;
      required = scaled > Number.MAX_SAFE_INTEGER
        ? exact * 4n
        : BigInt(Math.ceil(scaled));
    }
  }

  let utilization: number | null = null;
  let utilizationStatus: CalculatorResult["utilizationStatus"] = "none";
  if (required !== null && capacity > 0n) {
    utilization = Number((required * 10_000n) / capacity) / 100;
    utilizationStatus =
      required > capacity ? "invalid" : utilization > 80 ? "red" : utilization > 50 ? "amber" : "green";
    if (required > capacity) problems.push("Required capacity exceeds valid capacity.");
  }

  let lifetimeDays: bigint | null = null;
  if (input.recordsPerDay !== undefined && input.recordsPerDay > 0n) {
    lifetimeDays = capacity / input.recordsPerDay;
  }

  const totalLen = input.bodyLength + input.checksumLength;
  const displayedLength =
    totalLen + (input.separator ? groupingFor(totalLen).length - 1 : 0) + input.prefix.length + input.suffix.length;

  const examples: Array<{ id: string; code: string; blocked?: boolean }> = [];
  if (problems.length === 0) {
    try {
      const profile = calculatorProfile(input);
      if (profile === null) throw new Error("calculatorProfile returned null");
      const h = new Baseh(profile);
      const ids = [0n, 1n, BigInt(alphabet.length) - 1n, BigInt(alphabet.length), capacity - 1n];
      for (const id of new Set(ids)) {
        if (id < 0n || id >= capacity) continue;
        try {
          examples.push({ id: id.toString(), code: h.encode(id) });
        } catch (e) {
          if (e instanceof BasehError && e.code === "BLOCKED_CODE") {
            examples.push({ id: id.toString(), code: "", blocked: true });
          } else {
            throw e;
          }
        }
      }
    } catch {
      problems.push("Configuration could not produce example codes.");
    }
  }

  const falseAcceptance =
    input.checksumLength === 0 ? "n/a" : `about 1 in ${checksumStates.toString()}`;

  return {
    valid: problems.length === 0,
    problems,
    alphabet,
    capacity,
    displayedCombinations,
    bits,
    maxId: capacity > 0n ? capacity - 1n : null,
    required,
    utilization,
    utilizationStatus,
    lifetimeDays,
    checksumStates,
    falseAcceptance,
    displayedLength,
    generations: null,
    requiredGeneration: null,
    examples
  };
}

/**
 * Expandable-mode calculator (spec 19). There is no single capacity number:
 * codes start at minLength and grow one symbol at a time as each generation
 * fills, so the result carries the per-generation table with cumulative
 * totals, and demand analysis reports the generation the demand lands in.
 */
function calculateExpandable(input: CalculatorInput): CalculatorResult {
  const problems: string[] = [];
  const alphabet = deriveExpandableBodyAlphabet(input.alphabetMode, input.customAlphabet, input.visualSafety, input.spokenSafety, input.profanity);
  const checksumAlphabet = deriveExpandableChecksumAlphabet(alphabet);
  if (alphabet.length < 2) problems.push("Alphabet needs at least two symbols after removing 0 and O.");
  if (/[^\x20-\x7e]/.test(alphabet)) problems.push("Alphabet must be ASCII in version 1.");
  if (!Number.isInteger(input.minLength) || input.minLength < 1) problems.push("Minimum length must be an integer of at least 1.");
  if (input.minLength <= input.checksumLength) problems.push("Minimum length must be greater than the checksum length.");
  if (input.checksumLength < 0 || input.checksumLength > 8) problems.push("Checksum length must be 0 through 8.");
  if (!Number.isInteger(input.separatorMinLength) || input.separatorMinLength < 0) problems.push("Separator minimum length must be an integer of at least 0.");
  for (const ch of input.separator + input.prefix + input.suffix) {
    if (alphabet.includes(ch) || checksumAlphabet.includes(ch)) {
      problems.push(`Separator or affix "${ch}" collides with an alphabet.`);
      break;
    }
  }

  const a = alphabet.length;
  const generations = input.minLength >= 1 && input.minLength > input.checksumLength
    ? generationTable(Math.max(a, 2), input.checksumLength, input.minLength, 8)
    : [];
  const checksumStates = powBigInt(BigInt(Math.max(checksumAlphabet.length, 1)), input.checksumLength);
  const bits = ((input.minLength - input.checksumLength) * Math.log2(Math.max(a, 2))).toFixed(1);

  let required: bigint | null = null;
  if (input.recordsPerDay !== undefined && input.retentionDays !== undefined) {
    if (input.recordsPerDay < 0n || input.retentionDays < 0n) {
      problems.push("Demand values must not be negative.");
    } else {
      const exact = input.recordsPerDay * input.retentionDays;
      const scaled = Number(exact) * input.peakMultiplier * input.safetyMargin;
      required = scaled > Number.MAX_SAFE_INTEGER ? exact * 4n : BigInt(Math.ceil(scaled));
    }
  }

  let requiredGeneration: number | null = null;
  let utilization: number | null = null;
  let utilizationStatus: CalculatorResult["utilizationStatus"] = "none";
  if (required !== null && required > 0n && problems.length === 0) {
    requiredGeneration = generationForDemand(a, input.checksumLength, input.minLength, required - 1n);
    const cumulative = generationCumulative(a, input.checksumLength, input.minLength, requiredGeneration);
    utilization = Number((required * 10_000n) / cumulative) / 100;
    utilizationStatus = utilization > 80 ? "amber" : "green";
  }

  let lifetimeDays: bigint | null = null;
  if (input.recordsPerDay !== undefined && input.recordsPerDay > 0n && problems.length === 0) {
    // Days to fill the generation the demand lands in (or the last table
    // generation when no retention period is given); the namespace never
    // runs out, this is when the codes get one character longer.
    const through = requiredGeneration ?? generations[generations.length - 1]!.length;
    lifetimeDays = generationCumulative(a, input.checksumLength, input.minLength, through) / input.recordsPerDay;
  }

  const displayedLength = expandableDisplayedLength(input.minLength, input.separator, input.separatorMinLength)
    + input.prefix.length + input.suffix.length;

  const examples: Array<{ id: string; code: string; blocked?: boolean }> = [];
  if (problems.length === 0) {
    try {
      const profile = calculatorProfile(input);
      if (profile === null) throw new Error("calculatorProfile returned null");
      const h = new Baseh(profile);
      // The boundary ids show the growth: the last and first codes of the
      // opening generations, and the first code two generations up (which
      // carries a separator under the default separatorMinLength of 6).
      const end1 = generations[0]!.cumulative - 1n;
      const start2 = generations[0]!.cumulative;
      const start3 = generations[1]!.cumulative;
      for (const id of new Set([0n, 1n, end1, start2, start3])) {
        if (id < 0n) continue;
        try {
          examples.push({ id: id.toString(), code: h.encode(id) });
        } catch (e) {
          if (e instanceof BasehError && e.code === "BLOCKED_CODE") {
            examples.push({ id: id.toString(), code: "", blocked: true });
          } else {
            throw e;
          }
        }
      }
    } catch {
      problems.push("Configuration could not produce example codes.");
    }
  }

  const falseAcceptance =
    input.checksumLength === 0 ? "n/a" : `about 1 in ${checksumStates.toString()}`;

  return {
    valid: problems.length === 0,
    problems,
    alphabet,
    capacity: 0n, // fixed-mode only (spec 12.3); see `generations`
    displayedCombinations: 0n,
    bits,
    maxId: null,
    required,
    utilization,
    utilizationStatus,
    lifetimeDays,
    checksumStates,
    falseAcceptance,
    displayedLength,
    generations,
    requiredGeneration,
    examples
  };
}

// Delimiter grouping rule: the balanced split of spec 19.5 — groups differ
// in size by at most one, larger groups to the left. Length 3 or fewer
// gets no delimiter at all.
export function groupingFor(totalLen: number): number[] {
  if (totalLen <= 3) return [];
  return expandableGrouping(totalLen);
}

// ---------------------------------------------------------------- designer

export interface DesignerInput {
  requiredCapacity: bigint;
  recordsPerDay?: bigint;
  retentionDays?: bigint;
  peakMultiplier: number;
  safetyMargin: number;
  maxDisplayedLength: number;
  minimumChecksumLength: number;
  maxUtilization: number; // 0..1
  separator: string;
  allowDigits: boolean;
  allowUpper: boolean;
  allowAlnum: boolean;
  visualSafety: SafetyLevel;
  spokenSafety: SafetyLevel;
  profanity: ProfanityMode;
  permutation: boolean;
  /** Spec 21. 0 disables the repetition filter; otherwise at least 3. */
  maxRepetition: number;
}

interface AlphabetEntry {
  id: string;
  alphabet: string;
  size: number;
  penalty: number;
}

export interface Candidate {
  alphabetId: string;
  alphabet: string;
  alphabetSize: number;
  spoken: SafetyLevel;
  separator: string;
  profanity: ProfanityMode;
  bodyLength: number;
  checksumLength: number;
  /** Spec 21. 0 disables the repetition filter. */
  maxRepetition: number;
  capacity: bigint;
  displayedLength: number;
  utilization: number;
  score: number;
  reason: string;
}

export interface DesignerResult {
  feasible: Candidate[];
  recommended: Candidate | null;
  alternatives: Array<{ label: string; candidate: Candidate }>;
  repair: string | null;
  requiredCapacity: bigint;
}

function allowedAlphabets(input: DesignerInput): AlphabetEntry[] {
  const out: AlphabetEntry[] = [];
  const visual = input.visualSafety;
  const spoken = input.spokenSafety;
  const profanity = input.profanity;
  const spTag = spoken === "none" ? "" : `-sp${spoken[0]}`;
  const pfTag = profanity === "none" ? "" : profanity === "no-vowels" ? "-nv" : "-bl";
  if (visual === "heavy") {
    const derived = deriveAlphabet("alnum", "", visual, spoken, profanity);
    return [{ id: `safe${derived.length}${spTag}${pfTag}`, alphabet: derived, size: derived.length, penalty: 0 }];
  }
  if (input.allowAlnum) {
    const derived = deriveAlphabet("alnum", "", visual, spoken, profanity);
    out.push({ id: visual === "none" && spoken === "none" && profanity === "none" ? "alnum36" : `alnum${derived.length}-${visual}${spTag}${pfTag}`, alphabet: derived, size: derived.length, penalty: 0 });
  }
  if (input.allowUpper) {
    const derived = deriveAlphabet("upper", "", visual, spoken, profanity);
    out.push({ id: visual === "none" && spoken === "none" && profanity === "none" ? "upper26" : `upper${derived.length}-${visual}${spTag}${pfTag}`, alphabet: derived, size: derived.length, penalty: 10 });
  }
  if (input.allowDigits) {
    out.push({ id: "digits10", alphabet: DIGITS, size: 10, penalty: 10 });
  }
  return out;
}

export function requiredCapacity(input: DesignerInput): bigint {
  let required = input.requiredCapacity;
  if (input.recordsPerDay !== undefined && input.retentionDays !== undefined) {
    const exact = input.recordsPerDay * input.retentionDays;
    const scaled = Number(exact) * input.peakMultiplier * input.safetyMargin;
    const demand = scaled > Number.MAX_SAFE_INTEGER ? exact * 4n : BigInt(Math.ceil(scaled));
    if (demand > required) required = demand;
  }
  return required;
}

export function minimumLength(alphabetSize: number, required: bigint): number {
  const a = BigInt(alphabetSize);
  let l = Math.max(1, Math.ceil(Math.log2(Number(required > 1n ? required : 2n)) / Math.log2(alphabetSize)));
  while (l > 1 && powBigInt(a, l - 1) >= required) l -= 1;
  while (powBigInt(a, l) < required) l += 1;
  return l;
}

export function design(input: DesignerInput): DesignerResult {
  const required = requiredCapacity(input);
  const sep = input.separator;
  let separatorRejected = false;
  const candidates: Candidate[] = [];
  for (const alpha of allowedAlphabets(input)) {
    if (alpha.size < 2) continue;
    // A delimiter that is itself an alphabet symbol makes the profile
    // invalid (decoding could not tell delimiter from data), so every
    // candidate on that alphabet violates a hard constraint.
    if (sep && (alpha.alphabet.includes(sep) ||
        deriveChecksumAlphabet(alpha.alphabet, input.spokenSafety, input.profanity).includes(sep))) {
      separatorRejected = true;
      continue;
    }
    for (let bodyLength = 1; bodyLength <= 10; bodyLength += 1) {
      const capacity = powBigInt(BigInt(alpha.size), bodyLength);
      if (capacity < required) continue;
      for (let checksumLength = Math.max(input.minimumChecksumLength, 0); checksumLength <= 3; checksumLength += 1) {
        const totalLen = bodyLength + checksumLength;
        const displayed = totalLen + (input.separator ? groupingFor(totalLen).length - 1 : 0);
        if (displayed > input.maxDisplayedLength) continue;
        const utilPerMyriad = Number((required * 10_000n) / capacity) / 10_000;
        if (utilPerMyriad > input.maxUtilization && required > 0n) continue;
        const utilPenalty =
          utilPerMyriad <= 0.5 ? 0 : utilPerMyriad <= 0.7 ? 20 : utilPerMyriad <= 0.8 ? 100 : utilPerMyriad <= 0.9 ? 500 : 1e9;
        const checksumPenalty = input.minimumChecksumLength > 0 ? 0 : [40, 0, 5, 15][checksumLength] ?? 15;
        const score = displayed * 1000 + utilPenalty + alpha.penalty + checksumPenalty;
        candidates.push({
          alphabetId: alpha.id,
          alphabet: alpha.alphabet,
          alphabetSize: alpha.size,
          spoken: input.spokenSafety,
          separator: input.separator,
          profanity: input.profanity,
          bodyLength,
          checksumLength,
          maxRepetition: input.maxRepetition,
          capacity,
          displayedLength: displayed,
          utilization: utilPerMyriad,
          score,
          reason: ""
        });
      }
    }
  }

  candidates.sort((a, b) =>
    a.score - b.score || a.displayedLength - b.displayedLength ||
    (a.capacity < b.capacity ? -1 : 1) || a.alphabetId.localeCompare(b.alphabetId)
  );

  const withReasons = candidates.map((c) => ({
    ...c,
    reason: `${c.bodyLength} body + ${c.checksumLength} check, alphabet ${c.alphabetId}, utilization ${(c.utilization * 100).toFixed(1)}%`
  }));

  const recommended = withReasons[0] ?? null;
  const rest = withReasons.slice(1);
  const alternatives: Array<{ label: string; candidate: Candidate }> = [];
  const pick = (label: string, pred: (c: Candidate) => boolean) => {
    const found = rest.find((c) => pred(c) && !alternatives.some((a) => a.candidate === c));
    if (found) alternatives.push({ label, candidate: found });
  };
  pick("Shortest", () => true);
  pick("Stronger validation", (c) => recommended === null || c.checksumLength > recommended.checksumLength);
  pick("Digits only", (c) => c.alphabetId === "digits10");
  pick("Most growth room", (c) => c.utilization <= 0.1);

  let repair: string | null = null;
  if (separatorRejected) {
    repair = `Delimiter "${sep}" appears in one or more alphabets, so those candidates are hidden: a delimiter must never be an alphabet symbol. Try "-" or "." instead.`;
  }
  if (withReasons.length === 0) {
    if (separatorRejected) {
      const sepFree = allowedAlphabets(input).filter((alpha) =>
        !alpha.alphabet.includes(sep) && !deriveChecksumAlphabet(alpha.alphabet, input.spokenSafety, input.profanity).includes(sep));
      repair = sepFree.length === 0
        ? `Every allowed alphabet contains the delimiter "${sep}", so no valid candidate exists. Pick a delimiter that never appears in codes (such as "-" or ".") or remove it.`
        : repair;
    } else {
      const alphas = allowedAlphabets(input);
      let best: string | null = null;
      for (const alpha of alphas) {
        const minL = minimumLength(alpha.size, required);
        const total = minL + Math.max(input.minimumChecksumLength, 0);
        const displayed = total + (input.separator ? groupingFor(total).length - 1 : 0);
        if (best === null) {
          best = `No candidate fits. The smallest option with alphabet ${alpha.id} (${alpha.size} symbols) needs a ${displayed}-character displayed code (body ${minL}${input.minimumChecksumLength > 0 ? ` + ${input.minimumChecksumLength} check` : ""}). Raise the maximum displayed length to at least ${displayed} or permit a larger alphabet.`;
        }
      }
      repair = best;
    }
  }

  return { feasible: withReasons, recommended, alternatives: alternatives.slice(0, 5), repair, requiredCapacity: required };
}

export interface ExpandableDesign {
  alphabetId: string;
  bodyAlphabet: string;
  checksumLength: number;
  minLength: number;
  separatorMinLength: number;
  /** Spec 21. 0 disables the repetition filter. */
  maxRepetition: number;
  /** Capacity of the opening generation (codes at minLength). */
  startCapacity: bigint;
  /** The generation whose cumulative range holds the required demand. */
  generation: number;
  /** Total ids issuable from minLength through `generation`. */
  cumulativeAtGeneration: bigint;
  displayedAtStart: number;
  displayedAtGeneration: number;
}

/**
 * The expandable answer to the designer's requirements (spec 19). Expandable
 * mode never runs out — codes start short and grow one symbol at a time — so
 * instead of searching lengths this derives the frozen-tier shape on the best
 * allowed alphabet and reports the generation the demand lands in. Returns
 * null when no allowed alphabet survives the zero ban, or when the delimiter
 * collides with the derived alphabets.
 */
export function expandableDesign(input: DesignerInput): ExpandableDesign | null {
  const required = requiredCapacity(input);
  for (const alpha of allowedAlphabets(input)) {
    const body = [...alpha.alphabet].filter((c) => c !== "0" && c !== "O").join("");
    if (body.length < 2) continue;
    const checksumAlphabet = deriveExpandableChecksumAlphabet(body);
    if (input.separator && (body.includes(input.separator) || checksumAlphabet.includes(input.separator))) continue;
    const checksumLength = Math.min(3, Math.max(input.minimumChecksumLength, 2));
    const minLength = 4;
    const separatorMinLength = 6;
    const generation = generationForDemand(body.length, checksumLength, minLength, required > 1n ? required - 1n : 0n);
    return {
      alphabetId: `${alpha.id}-exp`,
      bodyAlphabet: body,
      checksumLength,
      minLength,
      separatorMinLength,
      maxRepetition: input.maxRepetition,
      startCapacity: generationCapacityAt(body.length, checksumLength, minLength),
      generation,
      cumulativeAtGeneration: generationCumulative(body.length, checksumLength, minLength, generation),
      displayedAtStart: expandableDisplayedLength(minLength, input.separator, separatorMinLength),
      displayedAtGeneration: expandableDisplayedLength(generation, input.separator, separatorMinLength)
    };
  }
  return null;
}

/** The live-preview profile an expandable design samples with. */
export function expandableProfile(d: ExpandableDesign, input: DesignerInput, permutation: boolean): BasehProfile {
  const canonical = deriveExpandableChecksumAlphabet(d.bodyAlphabet);
  return {
    profileId: "ui-preview-expandable",
    mode: "expandable",
    bodyAlphabet: d.bodyAlphabet,
    minLength: d.minLength,
    checksumAlphabet: canonical,
    checksumLength: d.checksumLength,
    caseSensitive: false,
    separator: input.separator,
    separatorMinLength: d.separatorMinLength,
    grouping: [],
    aliases: { ...baseAliases(canonical), ...spokenAliases(d.bodyAlphabet, input.spokenSafety) },
    profanity: { mode: input.profanity },
    permutation: previewPermutation(permutation),
    maxRepetition: d.maxRepetition
  };
}

/** The live-preview profile a designer candidate samples with. */
export function candidateProfile(c: Candidate, permutation: boolean): BasehProfile {
  const totalLen = c.bodyLength + c.checksumLength;
  return {
    profileId: "ui-preview",
    bodyAlphabet: c.alphabet,
    bodyLength: c.bodyLength,
    checksumAlphabet: deriveChecksumAlphabet(c.alphabet, c.spoken, c.profanity),
    checksumLength: c.checksumLength,
    caseSensitive: false,
    separator: c.separator,
    grouping: c.separator ? groupingFor(totalLen) : [],
    aliases: { ...baseAliases(c.alphabet), ...spokenAliases(c.alphabet, c.spoken) },
    profanity: { mode: c.profanity },
    permutation: previewPermutation(permutation),
    maxRepetition: c.maxRepetition
  };
}

/** Rendered example codes for a candidate, using the published demo key. */
export function sampleCodes(
  alphabet: string,
  bodyLength: number,
  checksumLength: number,
  capacity: bigint,
  spoken: SafetyLevel = "none",
  separator: string = "",
  profanity: ProfanityMode = "none",
  permutation: boolean = false,
  maxRepetition: number = 4
): Array<{ id: string; code: string; blocked?: boolean }> {
  const out: Array<{ id: string; code: string; blocked?: boolean }> = [];
  try {
    const profile = candidateProfile(
      { alphabet, bodyLength, checksumLength, spoken, separator, profanity, maxRepetition } as Candidate,
      permutation
    );
    const h = new Baseh(profile);
    for (const id of new Set([0n, 1n, capacity - 1n])) {
      if (id < 0n || id >= capacity) continue;
      try {
        out.push({ id: id.toString(), code: h.encode(id) });
      } catch (e) {
        // Blocklist mode reserves some ids; show the gap instead of hiding it.
        if (e instanceof BasehError && e.code === "BLOCKED_CODE") {
          out.push({ id: id.toString(), code: "", blocked: true });
        } else {
          throw e;
        }
      }
    }
  } catch {
    // An unsamplable candidate simply shows no examples.
  }
  return out;
}

export function exportDesign(input: DesignerInput, result: DesignerResult): string {
  return JSON.stringify({
    designerVersion: DESIGNER_VERSION,
    catalogVersion: CATALOG_VERSION,
    scoringVersion: SCORING_VERSION,
    requirements: {
      requiredCapacity: result.requiredCapacity.toString(),
      maxDisplayedLength: input.maxDisplayedLength,
      minimumChecksumLength: input.minimumChecksumLength
    },
    recommendation: result.recommended
      ? {
          alphabetId: result.recommended.alphabetId,
          bodyLength: result.recommended.bodyLength,
          checksumLength: result.recommended.checksumLength,
          capacity: result.recommended.capacity.toString()
        }
      : null
  }, null, 2);
}
