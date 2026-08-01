import { BasehError } from "./errors.js";
import { decodeBaseN, encodeBaseN, alphabetIndex } from "./basen.js";
import { calculateChecksum } from "./checksum.js";
import { inversePermute, permute } from "./feistel.js";
import { prepareProfile } from "./profile.js";
/** Built-in spoken-confusion candidate maps. Spec 3.3; pairs apply to body symbols only. */
export const CONFUSION_MAPS = {
    light: { B: ["D"], D: ["B"], P: ["T"], T: ["P"] },
    medium: { B: ["D"], D: ["B"], P: ["T"], T: ["P"], M: ["N"], N: ["M"], V: ["W"], W: ["V"] },
    heavy: {
        B: ["D"], D: ["B"], P: ["T"], T: ["P"], M: ["N"], N: ["M"],
        V: ["W"], W: ["V"], F: ["S"], S: ["F"], C: ["G"], G: ["C"]
    }
};
const ASCII_WS = /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g;
const MAX_CANDIDATES = 64;
/** Spec 3.1 normalization, steps 1-7. Returns the raw unformatted string. */
export function normalize(input, profile, acceptSpaces = false) {
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
            throw new BasehError("INVALID_CHARACTER", `Symbol ${JSON.stringify(ch)} is not accepted`);
        }
    }
    const expected = profile.bodyLength + profile.checksumLength;
    // Spec 3.4: a code that lost leading zero body symbols is re-padded with
    // the body zero symbol. The checksum symbols always remain, so the split
    // point is unambiguous. A fully stripped no-checksum code would be empty
    // and stays a length error.
    if (s.length < expected && s.length >= Math.max(profile.checksumLength, 1)) {
        const zero = profile.bodyAlphabetNorm[0];
        s = zero.repeat(expected - s.length) + s;
    }
    if (s.length !== expected) {
        throw new BasehError("INVALID_LENGTH", `Expected ${expected} symbols, got ${s.length}`);
    }
    return s;
}
export function formatRaw(raw, profile) {
    if (profile.separator.length === 0)
        return raw;
    const parts = [];
    let o = 0;
    for (const size of profile.grouping) {
        parts.push(raw.slice(o, o + size));
        o += size;
    }
    return parts.join(profile.separator);
}
/** Spec 10. Substitution-only candidate generation, capped and deduplicated. */
export function generateCandidates(body, confusionMap, maxEdits = 1) {
    if (maxEdits === 0)
        return [];
    const results = new Set();
    const chars = [...body];
    for (let pos = 0; pos < chars.length; pos += 1) {
        const source = chars[pos];
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
    profile;
    bodyIndex;
    constructor(profile) {
        this.profile = prepareProfile(profile);
        this.bodyIndex = alphabetIndex(this.profile.bodyAlphabetNorm);
    }
    capacity() {
        return this.profile.capacity;
    }
    /** Spec 8. */
    encode(id) {
        let value = BigInt(id);
        if (value < 0n || value >= this.profile.capacity) {
            throw new BasehError("OUT_OF_RANGE", `ID ${value} is outside the profile capacity`);
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
        const raw = body + checksum;
        // Spec 18.2: case-insensitive substring scan over the raw code.
        if (this.profile.blocklist.length > 0) {
            const upper = raw.toUpperCase();
            for (const word of this.profile.blocklist) {
                if (upper.includes(word)) {
                    throw new BasehError("BLOCKED_CODE", "The generated reference contains a blocked substring", false);
                }
            }
        }
        return formatRaw(raw, this.profile);
    }
    /** Spec 9. */
    decode(input, options = {}) {
        const raw = normalize(input, this.profile, options.acceptSpaces === true);
        let body = raw.slice(0, this.profile.bodyLength);
        const suppliedChecksum = raw.slice(this.profile.bodyLength);
        // Spec 3.1 validates union membership before the split. There is no
        // per-region membership check: a checksum-region symbol outside the
        // checksum alphabet simply fails as INVALID_CHECKSUM, and a body symbol
        // outside the body alphabet fails later in decodeBaseN as INVALID_CHARACTER.
        if (calculateChecksum(this.profile, body) !== suppliedChecksum) {
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
            const map = {};
            for (const [source, replacements] of Object.entries(rawMap)) {
                const kept = replacements.filter((r) => bodySet.has(r));
                if (kept.length > 0)
                    map[source] = kept;
            }
            const valid = new Set();
            for (const candidate of generateCandidates(body, map, options.maxCorrections ?? 1)) {
                if (calculateChecksum(this.profile, candidate) === suppliedChecksum) {
                    valid.add(candidate);
                }
            }
            if (valid.size === 0) {
                throw new BasehError("INVALID_CHECKSUM", "The reference code did not pass validation");
            }
            if (valid.size > 1) {
                throw new BasehError("AMBIGUOUS_INPUT", "The reference code matches more than one record", false);
            }
            body = [...valid][0];
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
    validate(input, options = {}) {
        try {
            const result = this.decode(input, options);
            return { valid: true, canonicalCode: result.canonicalCode };
        }
        catch (err) {
            if (err instanceof BasehError)
                return { valid: false, reason: err.code };
            throw err;
        }
    }
}
