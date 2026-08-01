import { BasehError } from "./errors.js";
import { effectiveBlocklist, stripVowels } from "./blocklist.js";
const ASCII_ONLY = /^[\x20-\x7e]*$/;
function fail(reason) {
    throw new BasehError("INVALID_PROFILE", `Invalid baseH profile: ${reason}`, false);
}
function isAsciiChar(ch) {
    return ch.length === 1 && ASCII_ONLY.test(ch);
}
function norm(profile, ch) {
    return profile.caseSensitive ? ch : ch.toUpperCase();
}
function powBigInt(base, exp) {
    let result = 1n;
    for (let i = 0; i < exp; i += 1)
        result *= base;
    return result;
}
/**
 * Validates a profile per spec section 2.2 and returns it with derived,
 * pre-computed values. Throws BasehError INVALID_PROFILE on any violation.
 * Call once at construction, never per encode/decode.
 */
export function prepareProfile(profile) {
    if (!profile || typeof profile !== "object")
        fail("profile is required");
    if (typeof profile.profileId !== "string" || profile.profileId.length === 0) {
        fail("profileId must be non-empty");
    }
    if (!ASCII_ONLY.test(profile.profileId))
        fail("profileId must be ASCII");
    // Spec 2.2/19.9. A persisted or frozen profile declares its mode; profiles
    // built before the mode field existed are fixed, so the frozen vectors keep
    // matching byte for byte.
    const mode = profile.mode ?? "fixed";
    if (mode !== "fixed" && mode !== "expandable")
        fail("mode must be fixed or expandable");
    const caseSensitive = profile.caseSensitive === true;
    const bodyAlphabet = profile.bodyAlphabet;
    if (typeof bodyAlphabet !== "string" || bodyAlphabet.length < 2) {
        fail("bodyAlphabet needs at least two symbols");
    }
    for (const ch of bodyAlphabet) {
        if (!isAsciiChar(ch))
            fail(`body alphabet symbol is not single ASCII: ${JSON.stringify(ch)}`);
    }
    const view = { caseSensitive };
    let bodyNorm = [...bodyAlphabet].map((c) => norm(view, c)).join("");
    // Spec 19.2: in expandable mode the zero ban strips 0 and O from the body
    // alphabet silently, before any other validation, exactly like the
    // no-vowels strip of section 18.1.
    if (mode === "expandable") {
        bodyNorm = [...bodyNorm].filter((c) => c !== "0" && c !== "O").join("");
    }
    if (new Set(bodyNorm).size !== bodyNorm.length) {
        fail("body alphabet symbols must be unique after case normalization");
    }
    if (mode === "fixed") {
        if (!Number.isInteger(profile.bodyLength) ||
            profile.bodyLength < 1 ||
            profile.bodyLength > 32) {
            fail("bodyLength must be an integer from 1 through 32");
        }
    }
    const minLength = profile.minLength ?? 4;
    const separatorMinLength = profile.separatorMinLength ?? 0;
    if (mode === "fixed" && separatorMinLength !== 0) {
        fail("separatorMinLength must be 0 in fixed mode");
    }
    if (!Number.isInteger(profile.checksumLength) ||
        profile.checksumLength < 0 ||
        profile.checksumLength > 8) {
        fail("checksumLength must be an integer from 0 through 8");
    }
    if (mode === "expandable") {
        if (!Number.isInteger(minLength) || minLength < 1) {
            fail("minLength must be an integer of at least 1");
        }
        if (minLength <= profile.checksumLength) {
            fail("minLength must be greater than checksumLength");
        }
        if (!Number.isInteger(separatorMinLength) || separatorMinLength < 0) {
            fail("separatorMinLength must be an integer of at least 0");
        }
    }
    const checksumAlphabet = profile.checksumAlphabet ?? "";
    let checksumNorm = [...checksumAlphabet].map((c) => norm(view, c)).join("");
    if (mode === "expandable") {
        // Spec 19.3: the checksum alphabet is derived, "0" followed by the body
        // alphabet in order. The configured checksumAlphabet is not consulted.
        checksumNorm = "";
    }
    else if (profile.checksumLength > 0) {
        if (typeof checksumAlphabet !== "string" || checksumAlphabet.length < 2) {
            fail("checksumAlphabet needs at least two symbols when checksumLength is positive");
        }
        for (const ch of checksumAlphabet) {
            if (!isAsciiChar(ch))
                fail(`checksum alphabet symbol is not single ASCII: ${JSON.stringify(ch)}`);
        }
        if (new Set(checksumNorm).size !== checksumNorm.length) {
            fail("checksum alphabet symbols must be unique after case normalization");
        }
    }
    // Spec 18. no-vowels strips vowels before every downstream rule; blocklist
    // only arms the encode-time scan.
    const profanity = profile.profanity ?? { mode: "none" };
    if (!["none", "no-vowels", "blocklist"].includes(profanity.mode)) {
        fail("profanity mode must be none, no-vowels or blocklist");
    }
    if (profanity.mode === "no-vowels") {
        bodyNorm = stripVowels(bodyNorm);
        checksumNorm = stripVowels(checksumNorm);
        if (bodyNorm.length < 2) {
            fail("no-vowels mode leaves the body alphabet with fewer than two symbols");
        }
        if (mode === "fixed" && profile.checksumLength > 0 && checksumNorm.length < 2) {
            fail("no-vowels mode leaves the checksum alphabet with fewer than two symbols");
        }
    }
    if (mode === "expandable") {
        // Derived after every body strip (zero ban, no-vowels) so all downstream
        // rules — modulus, separator collision, alias targets — see the final
        // alphabets.
        checksumNorm = "0" + bodyNorm;
    }
    if (bodyNorm.length < 2) {
        fail("body alphabet needs at least two symbols after preparation");
    }
    const blocklist = profanity.mode === "blocklist" ? effectiveBlocklist(profanity) : [];
    const separator = profile.separator ?? "";
    for (const ch of separator) {
        if (bodyNorm.includes(ch) || checksumNorm.includes(ch)) {
            fail("separator must not occur in either alphabet");
        }
    }
    const aliases = profile.aliases ?? {};
    const aliasesNorm = {};
    const canonicalSet = new Set([...bodyNorm, ...checksumNorm]);
    for (const [src, tgt] of Object.entries(aliases)) {
        if (!isAsciiChar(src))
            fail(`alias source is not single ASCII: ${JSON.stringify(src)}`);
        if (!isAsciiChar(tgt))
            fail(`alias target is not single ASCII: ${JSON.stringify(tgt)}`);
        const sNorm = norm(view, src);
        const tNorm = norm(view, tgt);
        if (!canonicalSet.has(tNorm)) {
            fail(`alias target ${JSON.stringify(tgt)} is not a canonical symbol`);
        }
        // Spec 3.2: an alias must never map two distinct canonical symbols into
        // one value. Fixed mode rejects a canonical alias source outright. In
        // expandable mode the frozen tier (spec 17.1) carries aliases whose
        // sources are canonical body symbols (T, N, W stay in the body
        // alphabet); the canonical symbol wins at normalization, making those
        // entries inert instead of destructive.
        if (mode === "fixed" && canonicalSet.has(sNorm)) {
            fail(`alias source ${JSON.stringify(src)} is already a canonical symbol`);
        }
        if (sNorm in aliasesNorm)
            fail(`duplicate alias source ${JSON.stringify(sNorm)} after case normalization`);
        if (tNorm in aliases || [...Object.keys(aliases)].some((k) => norm(view, k) === tNorm)) {
            fail(`alias chain forbidden: target ${tNorm} is also an alias source`);
        }
        aliasesNorm[sNorm] = tNorm;
    }
    const total = bodySum(profile.grouping);
    if (separator.length === 0) {
        if (profile.grouping.length !== 0)
            fail("grouping must be empty when separator is empty");
    }
    else if (mode === "expandable") {
        // Spec 19.5: the sum rule cannot hold at every length; grouping is a
        // right-anchored repeating pattern and only needs positive sizes.
        if (total < 1 || profile.grouping.length === 0) {
            fail("expandable grouping must be non-empty with positive integer sizes");
        }
    }
    else if (total !== profile.bodyLength + profile.checksumLength) {
        fail("group sizes must sum to bodyLength + checksumLength");
    }
    const permutation = profile.permutation ?? { enabled: false };
    if (permutation.enabled) {
        if (permutation.algorithm !== "feistel-v1")
            fail("unknown permutation algorithm");
        if (typeof permutation.keyId !== "string" || permutation.keyId.length === 0) {
            fail("permutation requires a keyId");
        }
        if (!(permutation.keyBytes instanceof Uint8Array) || permutation.keyBytes.length === 0) {
            fail("permutation requires key material");
        }
        if (!Number.isInteger(permutation.rounds) ||
            permutation.rounds < 4 ||
            permutation.rounds > 16 ||
            permutation.rounds % 2 !== 0) {
            fail("Feistel rounds must be an even integer from 4 through 16");
        }
    }
    return {
        ...profile,
        mode,
        minLength,
        separatorMinLength,
        caseSensitive,
        checksumAlphabet,
        separator,
        grouping: [...profile.grouping],
        aliases: { ...aliases },
        permutation,
        bodyAlphabetNorm: bodyNorm,
        checksumAlphabetNorm: checksumNorm,
        aliasesNorm,
        checksumModulus: powBigInt(BigInt(checksumNorm.length || 1), profile.checksumLength),
        capacity: powBigInt(BigInt(bodyNorm.length), profile.bodyLength ?? 0),
        blocklist
    };
}
function bodySum(grouping) {
    if (!Array.isArray(grouping))
        return -1;
    let sum = 0;
    for (const g of grouping) {
        if (!Number.isInteger(g) || g < 1)
            return -1;
        sum += g;
    }
    return sum;
}
