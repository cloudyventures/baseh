/**
 * Shared math for the calculator and designer. No DOM access.
 * Capacity math is exact bigint; ratios are display-only Numbers.
 */
import { Baseh, type BasehProfile, DEMO_KEY_BYTES, DEMO_KEY_ID } from "base-human";

export type AlphabetMode = "digits" | "upper" | "alnum" | "custom";
export type SafetyLevel = "none" | "light" | "medium" | "heavy";

/**
 * Parse a required-capacity field: plain digits, grouped digits
 * ("60,000,000") or a compact suffix ("6k", "2.5m", "6b", "6t").
 * Returns null for anything that does not parse to an integer >= 1.
 */
export function parseRequired(raw: string): bigint | null {
  const cleaned = raw.replace(/[,_\s]/g, "");
  const m = cleaned.match(/^(\d+)(?:\.(\d+))?([kmbt])?$/i);
  if (!m) return null;
  const intPart = m[1]!;
  const fracPart = m[2] ?? "";
  const suffixExp = { k: 3, m: 6, b: 9, t: 12 }[m[3]?.toLowerCase() ?? ""] ?? 0;
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

export interface CalculatorInput {
  namespace: string;
  alphabetMode: AlphabetMode;
  customAlphabet: string;
  visualSafety: SafetyLevel;
  spokenSafety: SafetyLevel;
  bodyLength: number;
  checksumLength: number;
  permutation: boolean;
  separator: string;
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

/** Checksum alphabet with the same spoken drops, so alias sources stay non-canonical. */
export function deriveChecksumAlphabet(bodyAlphabet: string, spoken: SafetyLevel): string {
  const drops = new Set(spokenPairsFor(bodyAlphabet, spoken).map(([, drop]) => drop));
  return [...SAFE_CHECKSUM].filter((c) => !drops.has(c)).join("");
}

/** O/I/L aliases, keeping only those whose target exists and whose source does not. */
export function baseAliases(alphabet: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [src, tgt] of [["O", "0"], ["I", "1"], ["L", "1"]]) {
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

export function deriveAlphabet(mode: AlphabetMode, custom: string, visual: SafetyLevel, spoken: SafetyLevel = "none"): string {
  if (visual === "heavy") return applySpoken(SAFE_BODY, spoken);
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
  return applySpoken(chars.join(""), spoken);
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
  examples: Array<{ id: string; code: string }>;
}

export function calculate(input: CalculatorInput): CalculatorResult {
  const problems: string[] = [];
  const alphabet = deriveAlphabet(input.alphabetMode, input.customAlphabet, input.visualSafety, input.spokenSafety);
  const checksumAlphabet = deriveChecksumAlphabet(alphabet, input.spokenSafety);
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
  const groups = Math.ceil(totalLen / 4);
  const displayedLength =
    totalLen + (input.separator ? Math.max(groups - 1, 0) : 0) + input.prefix.length + input.suffix.length;

  const examples: Array<{ id: string; code: string }> = [];
  if (problems.length === 0) {
    try {
      const profile: BasehProfile = {
        profileId: "ui-preview",
        bodyAlphabet: alphabet,
        bodyLength: input.bodyLength,
        checksumAlphabet,
        checksumLength: input.checksumLength,
        caseSensitive: false,
        separator: input.separator,
        grouping: input.separator ? groupingFor(totalLen) : [],
        aliases: { ...baseAliases(alphabet), ...spokenAliases(alphabet, input.spokenSafety) },
        permutation: input.permutation
          ? { enabled: true, algorithm: "feistel-v1", keyId: DEMO_KEY_ID, keyBytes: DEMO_KEY_BYTES, rounds: 8 }
          : { enabled: false }
      };
      const h = new Baseh(profile);
      const ids = [0n, 1n, BigInt(alphabet.length) - 1n, BigInt(alphabet.length), capacity - 1n];
      for (const id of new Set(ids)) {
        if (id >= 0n && id < capacity) examples.push({ id: id.toString(), code: h.encode(id) });
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
    examples
  };
}

export function groupingFor(totalLen: number): number[] {
  const groups: number[] = [];
  let remaining = totalLen;
  while (remaining > 4) {
    groups.push(4);
    remaining -= 4;
  }
  if (remaining > 0) groups.push(remaining);
  return groups;
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
  bodyLength: number;
  checksumLength: number;
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
  const spTag = spoken === "none" ? "" : `-sp${spoken[0]}`;
  if (visual === "heavy") {
    const derived = applySpoken(SAFE_BODY, spoken);
    return [{ id: `safe${derived.length}${spTag}`, alphabet: derived, size: derived.length, penalty: 0 }];
  }
  if (input.allowAlnum) {
    const derived = deriveAlphabet("alnum", "", visual, spoken);
    out.push({ id: visual === "none" && spoken === "none" ? "alnum36" : `alnum${derived.length}-${visual}${spTag}`, alphabet: derived, size: derived.length, penalty: 0 });
  }
  if (input.allowUpper) {
    const derived = deriveAlphabet("upper", "", visual, spoken);
    out.push({ id: visual === "none" && spoken === "none" ? "upper26" : `upper${derived.length}-${visual}${spTag}`, alphabet: derived, size: derived.length, penalty: 10 });
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
  const candidates: Candidate[] = [];
  for (const alpha of allowedAlphabets(input)) {
    if (alpha.size < 2) continue;
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
          bodyLength,
          checksumLength,
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
  if (withReasons.length === 0) {
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

  return { feasible: withReasons, recommended, alternatives: alternatives.slice(0, 5), repair, requiredCapacity: required };
}

/** Rendered example codes for a candidate, using the published demo key. */
export function sampleCodes(
  alphabet: string,
  bodyLength: number,
  checksumLength: number,
  capacity: bigint,
  spoken: SafetyLevel = "none",
  separator: string = ""
): Array<{ id: string; code: string }> {
  const out: Array<{ id: string; code: string }> = [];
  try {
    const totalLen = bodyLength + checksumLength;
    const profile: BasehProfile = {
      profileId: "ui-preview",
      bodyAlphabet: alphabet,
      bodyLength,
      checksumAlphabet: deriveChecksumAlphabet(alphabet, spoken),
      checksumLength,
      caseSensitive: false,
      separator,
      grouping: separator ? groupingFor(totalLen) : [],
      aliases: { ...baseAliases(alphabet), ...spokenAliases(alphabet, spoken) },
      permutation: { enabled: true, algorithm: "feistel-v1", keyId: DEMO_KEY_ID, keyBytes: DEMO_KEY_BYTES, rounds: 8 }
    };
    const h = new Baseh(profile);
    for (const id of new Set([0n, 1n, capacity - 1n])) {
      if (id >= 0n && id < capacity) out.push({ id: id.toString(), code: h.encode(id) });
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
