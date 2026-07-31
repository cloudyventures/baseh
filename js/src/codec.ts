import { HrcError, type HrcErrorCode } from "./errors.js";
import { decodeBaseN, encodeBaseN, alphabetIndex } from "./basen.js";
import { calculateChecksum } from "./checksum.js";
import { inversePermute, permute } from "./feistel.js";
import { prepareProfile, type HrcProfile, type PreparedProfile } from "./profile.js";

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
  reason?: HrcErrorCode;
}

const ASCII_WS = /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g;
const MAX_CANDIDATES = 64;

/** Spec 3.1 normalization, steps 1-7. Returns the raw unformatted string. */
export function normalize(input: string, profile: PreparedProfile, acceptSpaces = false): string {
  let s = input.replace(ASCII_WS, "");
  if (profile.separator.length > 0) {
    s = s.split(profile.separator).join("");
  }
  if (acceptSpaces) {
    s = s.replace(/ /g, "");
  }
  if (!profile.caseSensitive) {
    s = s.toUpperCase();
  }
  s = [...s].map((ch) => profile.aliasesNorm[ch] ?? ch).join("");
  const allowed = new Set([...profile.bodyAlphabetNorm, ...profile.checksumAlphabetNorm]);
  for (const ch of s) {
    if (!allowed.has(ch)) {
      throw new HrcError("INVALID_CHARACTER", `Symbol ${JSON.stringify(ch)} is not accepted`);
    }
  }
  const expected = profile.bodyLength + profile.checksumLength;
  if (s.length !== expected) {
    throw new HrcError("INVALID_LENGTH", `Expected ${expected} symbols, got ${s.length}`);
  }
  return s;
}

export function formatRaw(raw: string, profile: PreparedProfile): string {
  if (profile.separator.length === 0) return raw;
  const parts: string[] = [];
  let o = 0;
  for (const size of profile.grouping) {
    parts.push(raw.slice(o, o + size));
    o += size;
  }
  return parts.join(profile.separator);
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
        throw new HrcError("TOO_MANY_CANDIDATES", "Candidate generation exceeded 64 entries", false);
      }
    }
  }
  return [...results];
}

export class Hrc {
  readonly profile: PreparedProfile;
  private readonly bodyIndex: Map<string, bigint>;

  constructor(profile: HrcProfile) {
    this.profile = prepareProfile(profile);
    this.bodyIndex = alphabetIndex(this.profile.bodyAlphabetNorm);
  }

  capacity(): bigint {
    return this.profile.capacity;
  }

  /** Spec 8. */
  encode(id: bigint | number): string {
    let value = BigInt(id);
    if (value < 0n || value >= this.profile.capacity) {
      throw new HrcError("OUT_OF_RANGE", `ID ${value} is outside the profile capacity`);
    }
    const perm = this.profile.permutation;
    if (perm.enabled) {
      value = permute(value, this.profile.capacity, {
        profileId: this.profile.profileId,
        keyBytes: perm.keyBytes,
        rounds: perm.rounds
      });
    }
    const body = encodeBaseN(value, this.profile.bodyAlphabetNorm, this.profile.bodyLength);
    const checksum = calculateChecksum(this.profile, body);
    return formatRaw(body + checksum, this.profile);
  }

  /** Spec 9. */
  decode(input: string, options: DecodeOptions = {}): DecodeResult {
    const raw = normalize(input, this.profile, options.acceptSpaces === true);
    let body = raw.slice(0, this.profile.bodyLength);
    const suppliedChecksum = raw.slice(this.profile.bodyLength);

    const bodyAllowed = new Set(this.profile.bodyAlphabetNorm);
    for (const ch of body) {
      if (!bodyAllowed.has(ch)) {
        throw new HrcError("INVALID_CHARACTER", `Symbol ${JSON.stringify(ch)} cannot appear in the body`);
      }
    }
    const checksumAllowed = new Set(this.profile.checksumAlphabetNorm);
    for (const ch of suppliedChecksum) {
      if (!checksumAllowed.has(ch)) {
        throw new HrcError("INVALID_CHARACTER", `Symbol ${JSON.stringify(ch)} cannot appear in the checksum`);
      }
    }

    if (calculateChecksum(this.profile, body) !== suppliedChecksum) {
      if (!options.tryCorrection || (options.maxCorrections ?? 1) === 0) {
        throw new HrcError("INVALID_CHECKSUM", "The reference code did not pass validation");
      }
      const mapName = options.confusionProfile ?? "light";
      const map = mapName === "none" ? {} : CONFUSION_MAPS[mapName];
      const valid = new Set<string>();
      for (const candidate of generateCandidates(body, map, options.maxCorrections ?? 1)) {
        if (calculateChecksum(this.profile, candidate) === suppliedChecksum) {
          valid.add(candidate);
        }
      }
      if (valid.size === 0) {
        throw new HrcError("INVALID_CHECKSUM", "The reference code did not pass validation");
      }
      if (valid.size > 1) {
        throw new HrcError("AMBIGUOUS_INPUT", "The reference code matches more than one record", false);
      }
      body = [...valid][0] as string;
    }

    let value = decodeBaseN(body, this.profile.bodyAlphabetNorm, this.bodyIndex);
    const perm = this.profile.permutation;
    if (perm.enabled) {
      value = inversePermute(value, this.profile.capacity, {
        profileId: this.profile.profileId,
        keyBytes: perm.keyBytes,
        rounds: perm.rounds
      });
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
      if (err instanceof HrcError) return { valid: false, reason: err.code };
      throw err;
    }
  }
}
