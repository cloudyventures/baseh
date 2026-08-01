import { BasehError, type BasehErrorCode } from "./errors.js";
import { decodeBaseN, encodeBaseN, alphabetIndex, powBigInt } from "./basen.js";
import { calculateChecksum } from "./checksum.js";
import { inversePermute, permute } from "./feistel.js";
import { prepareProfile, effectiveChecksumLength, type BasehProfile, type PreparedProfile } from "./profile.js";

export type ConfusionProfileName = "none" | "light" | "medium" | "heavy";

/** Built-in spoken-confusion candidate maps. Spec 3.3; pairs apply to body symbols only. */
export const CONFUSION_MAPS: Record<Exclude<ConfusionProfileName, "none">, Record<string, string[]>> = {
  light: { B: ["D"], D: ["B"], P: ["T"], T: ["P"] },
  medium: { B: ["D"], D: ["B"], P: ["T"], T: ["P"], M: ["N"], N: ["M"], V: ["W"], W: ["V"] },
  heavy: {
    B: ["D"], D: ["B"], P: ["T"], T: ["P"], M: ["N"], N: ["M"],
    V: ["W"], W: ["V"], F: ["S"], S: ["F"], C: ["G"], G: ["C"]
  }
};

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

/**
 * Spec 12.5. Live as-you-type feedback for a code entry field. `typing`
 * carries the normalized typed symbols with separators inserted as far as
 * the groups go, plus a progress fraction; `invalid` carries the
 * BasehErrorCode from validate; `valid` is only ever reported for a
 * complete code.
 */
export type InspectResult =
  | { state: "empty" }
  | { state: "typing"; typed: string; progress: number }
  | { state: "bad-char" }
  | { state: "too-long" }
  | { state: "invalid"; reason: BasehErrorCode }
  | { state: "valid"; id: bigint; canonicalCode: string };

const ASCII_WS = /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g;
const INSPECT_WS = /[\t\n\v\f\r ]/;
const MAX_CANDIDATES = 64;

/** Spec 3.1 normalization, steps 1-7. Returns the raw unformatted string. */
export function normalize(input: string, profile: PreparedProfile, acceptSpaces = false): string {
  let s = input.replace(ASCII_WS, "");
  const hadSeparator = profile.separator.length > 0 && s.includes(profile.separator);
  if (profile.separator.length > 0) {
    s = s.split(profile.separator).join("");
  }
  if (acceptSpaces) {
    s = s.replace(/ /g, "");
  }
  if (!profile.caseSensitive) {
    s = s.toUpperCase();
  }
  const allowed = new Set([...profile.bodyAlphabetNorm, ...profile.checksumAlphabetNorm]);
  // Spec 3.2: an alias never maps two distinct canonical symbols into one
  // value, so a symbol that is already canonical stays as-is and only
  // non-canonical symbols are aliased. (In fixed tiers alias sources are
  // never canonical, so this changes nothing there.)
  s = [...s].map((ch) => (allowed.has(ch) ? ch : (profile.aliasesNorm[ch] ?? ch))).join("");
  for (const ch of s) {
    if (!allowed.has(ch)) {
      throw new BasehError("INVALID_CHARACTER", `Symbol ${JSON.stringify(ch)} is not accepted`);
    }
  }
  if (profile.mode === "expandable") {
    // Spec 19.2/19.7: no left-padding and no stripped-zero leniency. Input
    // shorter than minLength or longer than 32 fails INVALID_LENGTH, and a
    // separator below separatorMinLength is rejected (spec 19.5: the decoder
    // expects no separators there).
    if (s.length < profile.minLength) {
      throw new BasehError("INVALID_LENGTH", `Expected at least ${profile.minLength} symbols, got ${s.length}`);
    }
    if (s.length > 32) {
      throw new BasehError("INVALID_LENGTH", `Expected at most 32 symbols, got ${s.length}`);
    }
    if (hadSeparator && s.length < profile.separatorMinLength) {
      throw new BasehError(
        "INVALID_CHARACTER",
        `Separators do not appear below ${profile.separatorMinLength} symbols`
      );
    }
    return s;
  }
  const expected = (profile.bodyLength as number) + profile.checksumLength;
  // Spec 3.4: a code that lost leading zero body symbols is re-padded with
  // the body zero symbol. The checksum symbols always remain, so the split
  // point is unambiguous. A fully stripped no-checksum code would be empty
  // and stays a length error.
  if (s.length < expected && s.length >= Math.max(profile.checksumLength, 1)) {
    const zero = profile.bodyAlphabetNorm[0] as string;
    s = zero.repeat(expected - s.length) + s;
  }
  if (s.length !== expected) {
    throw new BasehError("INVALID_LENGTH", `Expected ${expected} symbols, got ${s.length}`);
  }
  return s;
}

function formatWith(raw: string, sizes: number[], separator: string): string {
  if (separator.length === 0) return raw;
  const parts: string[] = [];
  let o = 0;
  for (const size of sizes) {
    parts.push(raw.slice(o, o + size));
    o += size;
  }
  return parts.join(separator);
}

export function formatRaw(raw: string, profile: PreparedProfile): string {
  if (profile.mode === "expandable") {
    if (raw.length < profile.separatorMinLength) return raw;
    return formatWith(raw, expandableGrouping(raw.length), profile.separator);
  }
  return formatWith(raw, profile.grouping, profile.separator);
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

/**
 * Spec 19.1/22.3. First id of generation L: the sum of each generation's
 * capacity A^(k - effectiveK(k)) for k from minLength through L-1. The
 * effective checksum length is per-generation (spec 22), so the sum is not
 * a single geometric series when the short checksum is on.
 */
export function generationBase(profile: PreparedProfile, length: number): bigint {
  let base = 0n;
  for (let l = profile.minLength; l < length; l += 1) {
    base += generationCapacity(profile, l);
  }
  return base;
}

/** Spec 19.1/22.3. Ids held by generation L: A^(L - effectiveK(L)). */
export function generationCapacity(profile: PreparedProfile, length: number): bigint {
  return powBigInt(
    BigInt(profile.bodyAlphabetNorm.length),
    length - effectiveChecksumLength(profile, length)
  );
}

/** Smallest generation whose range holds id, per spec 19.6. */
export function generationForId(profile: PreparedProfile, id: bigint): number {
  let l = profile.minLength;
  let base = 0n;
  let cap = generationCapacity(profile, l);
  while (id >= base + cap) {
    // Codes cap at 32 symbols, so generation 33 is the hard ceiling.
    // Throwing from inside keeps an adversarial huge id from spinning the
    // loop (and its bigint multiplications) without bound.
    if (l >= 32) {
      throw new BasehError("OUT_OF_RANGE", "ID requires a code longer than 32 symbols");
    }
    base += cap;
    l += 1;
    cap = generationCapacity(profile, l);
  }
  return l;
}

/** Spec 10. Substitution-only candidate generation, capped and deduplicated. */
export function generateCandidates(
  body: string,
  confusionMap: Record<string, string[]>,
  maxEdits = 1
): string[] {
  if (maxEdits === 0) return [];
  const results = new Set<string>();
  const chars = [...body];
  for (let pos = 0; pos < chars.length; pos += 1) {
    const source = chars[pos] as string;
    for (const replacement of confusionMap[source] ?? []) {
      const candidate = [...chars];
      candidate[pos] = replacement;
      results.add(candidate.join(""));
      if (results.size > MAX_CANDIDATES) {
        throw new BasehError("TOO_MANY_CANDIDATES", "Candidate generation exceeded 64 entries", false);
      }
    }
  }
  return [...results];
}

export class Baseh {
  readonly profile: PreparedProfile;
  private readonly bodyIndex: Map<string, bigint>;

  constructor(profile: BasehProfile) {
    this.profile = prepareProfile(profile);
    this.bodyIndex = alphabetIndex(this.profile.bodyAlphabetNorm);
  }

  capacity(): bigint {
    // Spec 12.3: fixed mode only. Expandable profiles have no single
    // capacity; use the per-generation formulas of spec 19.1.
    if (this.profile.mode !== "fixed") {
      throw new BasehError("INVALID_PROFILE", "capacity() is only defined for fixed-mode profiles", false);
    }
    return this.profile.capacity;
  }

  private permKey(length?: number): { profileId: string; keyBytes: Uint8Array; rounds: number; length?: number } {
    const perm = this.profile.permutation;
    if (!perm.enabled) throw new BasehError("INVALID_PROFILE", "permutation is disabled", false);
    return { profileId: this.profile.profileId, keyBytes: perm.keyBytes, rounds: perm.rounds, ...(length === undefined ? {} : { length }) };
  }

  private checkBlocked(raw: string): void {
    // Spec 18.2: case-insensitive substring scan over the raw code.
    if (this.profile.blocklist.length > 0) {
      const upper = raw.toUpperCase();
      for (const word of this.profile.blocklist) {
        if (upper.includes(word)) {
          throw new BasehError("BLOCKED_CODE", "The generated reference contains a blocked substring", false);
        }
      }
    }
    // Spec 21.2: a run of the same symbol at or above maxRepetition blocks
    // the code. Runs are measured on the raw string, so a separator never
    // breaks a run.
    const max = this.profile.maxRepetition;
    if (max > 0 && new RegExp(`(.)\\1{${max - 1},}`).test(raw)) {
      throw new BasehError("BLOCKED_CODE", "The generated reference repeats a symbol beyond the profile limit", false);
    }
  }

  /** Spec 8 (fixed mode). */
  private encodeFixed(id: bigint): string {
    let value = id;
    if (value < 0n || value >= this.profile.capacity) {
      throw new BasehError("OUT_OF_RANGE", `ID ${value} is outside the profile capacity`);
    }
    const perm = this.profile.permutation;
    if (perm.enabled) {
      value = permute(value, this.profile.capacity, this.permKey());
    }
    const body = encodeBaseN(value, this.profile.bodyAlphabetNorm, this.profile.bodyLength as number);
    const raw = body + calculateChecksum(this.profile, body, this.profile.checksumLength, this.bodyIndex);
    this.checkBlocked(raw);
    return formatRaw(raw, this.profile);
  }

  /** Spec 19.6. */
  private encodeExpandable(id: bigint): string {
    if (id < 0n) {
      throw new BasehError("OUT_OF_RANGE", `ID ${id} is negative`);
    }
    // generationForId throws OUT_OF_RANGE for ids beyond the 32-symbol ceiling.
    const l = generationForId(this.profile, id);
    let value = id - generationBase(this.profile, l);
    const domain = generationCapacity(this.profile, l);
    const perm = this.profile.permutation;
    if (perm.enabled) {
      value = permute(value, domain, this.permKey(l));
    }
    const k = effectiveChecksumLength(this.profile, l);
    const body = encodeBaseN(value, this.profile.bodyAlphabetNorm, l - k);
    const raw = body + calculateChecksum(this.profile, body, k, this.bodyIndex);
    this.checkBlocked(raw);
    return formatRaw(raw, this.profile);
  }

  /** Spec 8/19.6. */
  encode(id: bigint | number): string {
    const value = BigInt(id);
    return this.profile.mode === "expandable" ? this.encodeExpandable(value) : this.encodeFixed(value);
  }

  /** Spec 9/19.7. */
  decode(input: string, options: DecodeOptions = {}): DecodeResult {
    // Spec API is maxCorrections?: 0 | 1; anything else is a caller bug and
    // is rejected at the boundary instead of silently coerced.
    if (options.maxCorrections !== undefined && options.maxCorrections !== 0 && options.maxCorrections !== 1) {
      throw new BasehError("INVALID_PROFILE", "maxCorrections must be 0 or 1", false);
    }
    const raw = normalize(input, this.profile, options.acceptSpaces === true);
    // Spec 22: the generation is selected by the presented total length, so
    // the effective checksum length is a deterministic function of it.
    const effectiveK = this.profile.mode === "expandable"
      ? effectiveChecksumLength(this.profile, raw.length)
      : this.profile.checksumLength;
    const bodyLength = this.profile.mode === "expandable"
      ? raw.length - effectiveK
      : (this.profile.bodyLength as number);
    let body = raw.slice(0, bodyLength);
    const suppliedChecksum = raw.slice(bodyLength);

    // Spec 3.1 validates union membership before the split. There is no
    // per-region membership check: a checksum-region symbol outside the
    // checksum alphabet simply fails as INVALID_CHECKSUM, and a body symbol
    // outside the body alphabet fails later in decodeBaseN as INVALID_CHARACTER.

    if (calculateChecksum(this.profile, body, effectiveK, this.bodyIndex) !== suppliedChecksum) {
      if (!options.tryCorrection || (options.maxCorrections ?? 1) === 0) {
        throw new BasehError("INVALID_CHECKSUM", "The reference code did not pass validation");
      }
      const mapName = options.confusionProfile ?? "none";
      // Spec 10: replacements that are not body alphabet symbols are
      // dropped before candidate generation. A suggested symbol the alphabet
      // cannot contain (say a spoken drop on a stripped-alphabet profile)
      // could never validate; generating it anyway would throw
      // INVALID_CHARACTER from the checksum step instead of reporting an
      // honest INVALID_CHECKSUM.
      const bodySet = new Set(this.profile.bodyAlphabetNorm);
      const rawMap = mapName === "none" ? {} : CONFUSION_MAPS[mapName];
      const map: Record<string, string[]> = {};
      for (const [source, replacements] of Object.entries(rawMap)) {
        const kept = replacements.filter((r) => bodySet.has(r));
        if (kept.length > 0) map[source] = kept;
      }
      const valid = new Set<string>();
      for (const candidate of generateCandidates(body, map, options.maxCorrections ?? 1)) {
        if (calculateChecksum(this.profile, candidate, effectiveK, this.bodyIndex) === suppliedChecksum) {
          valid.add(candidate);
        }
      }
      if (valid.size === 0) {
        throw new BasehError("INVALID_CHECKSUM", "The reference code did not pass validation");
      }
      if (valid.size > 1) {
        throw new BasehError("AMBIGUOUS_INPUT", "The reference code matches more than one record", false);
      }
      body = [...valid][0] as string;
    }

    let value = decodeBaseN(body, this.profile.bodyAlphabetNorm, this.bodyIndex);
    const perm = this.profile.permutation;
    if (this.profile.mode === "expandable") {
      // Spec 19.7: the offset is de-permuted within the generation's own
      // domain, then the generation base is added back.
      const l = raw.length;
      if (perm.enabled) {
        value = inversePermute(value, generationCapacity(this.profile, l), this.permKey(l));
      }
      value = generationBase(this.profile, l) + value;
    } else if (perm.enabled) {
      value = inversePermute(value, this.profile.capacity, this.permKey());
    }
    const canonicalCode = this.encode(value);
    const canonicalRaw = canonicalCode.split(this.profile.separator).join("");
    return { id: value, canonicalCode, corrected: raw !== canonicalRaw };
  }

  /** Spec 12.4. Never throws on user input. */
  validate(input: string, options: DecodeOptions = {}): ValidateResult {
    try {
      const result = this.decode(input, options);
      return { valid: true, canonicalCode: result.canonicalCode };
    } catch (err) {
      if (err instanceof BasehError) return { valid: false, reason: err.code };
      throw err;
    }
  }

  /**
   * Spec 12.5. Live as-you-type inspection. Gates on the typed length before
   * validating, so spec 3.4 re-padding can never paint an incomplete fixed-mode
   * code `valid` (or `invalid`): a short fixed input is `typing`, never
   * checked. Never throws on user input.
   */
  inspect(input: string): InspectResult {
    const p = this.profile;
    // Remove every occurrence of the separator string, then drop ASCII
    // whitespace anywhere (a paste can carry either inside the code).
    const noSep = p.separator.length > 0 ? input.split(p.separator).join("") : input;
    const cleaned = [...noSep].filter((ch) => !INSPECT_WS.test(ch));
    const typedCount = cleaned.length;
    if (typedCount === 0) return { state: "empty" };

    const fixed = p.mode === "fixed";
    const expected = fixed ? (p.bodyLength as number) + p.checksumLength : 32;
    if (typedCount > expected) return { state: "too-long" };

    // Spec 3.1 steps 4-6, without the length checks: case normalization,
    // aliases, then union membership. A symbol outside both alphabets is
    // bad-char; a symbol valid only in the other region (say a checksum-only
    // symbol typed into the body) passes here and fails later under validate.
    const allowed = new Set([...p.bodyAlphabetNorm, ...p.checksumAlphabetNorm]);
    let s = cleaned.join("");
    if (!p.caseSensitive) s = s.toUpperCase();
    const raw = [...s].map((ch) => (allowed.has(ch) ? ch : (p.aliasesNorm[ch] ?? ch))).join("");
    if ([...raw].some((ch) => !allowed.has(ch))) return { state: "bad-char" };

    // Fixed mode: complete means exactly bodyLength + checksumLength symbols.
    // Expandable mode: every length from minLength through 32 is a complete
    // code (the length selects the generation), so typing is only below
    // minLength.
    const complete = fixed ? typedCount === expected : typedCount >= p.minLength;
    if (!complete) {
      return {
        state: "typing",
        typed: formatPartial(raw, p),
        progress: typedCount / (fixed ? expected : p.minLength)
      };
    }

    const result = this.validate(raw);
    if (!result.valid) return { state: "invalid", reason: result.reason ?? "INVALID_CHECKSUM" };
    const decoded = this.decode(raw);
    return { state: "valid", id: decoded.id, canonicalCode: decoded.canonicalCode };
  }
}

/**
 * Spec 12.5. Separators inserted into a partially typed code, as far as the
 * groups go. Fixed mode walks the configured grouping; expandable mode uses
 * the balanced grouping rule of spec 19.5 for the typed length, bare below
 * separatorMinLength.
 */
function formatPartial(raw: string, profile: PreparedProfile): string {
  if (profile.separator.length === 0) return raw;
  if (profile.mode === "expandable") {
    if (raw.length < profile.separatorMinLength) return raw;
    return formatWith(raw, expandableGrouping(raw.length), profile.separator);
  }
  const parts: string[] = [];
  let offset = 0;
  for (const size of profile.grouping) {
    if (offset >= raw.length) break;
    parts.push(raw.slice(offset, offset + size));
    offset += size;
  }
  return parts.join(profile.separator);
}
