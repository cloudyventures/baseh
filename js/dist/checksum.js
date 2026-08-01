import { BasehError } from "./errors.js";
import { alphabetIndex, encodeBaseN } from "./basen.js";
/**
 * Spec 6.2. Rolling polynomial checksum over symbol values.
 * Returns the checksum value in [0, modulus).
 * Spec 22: expandable generations may pass a shorter effective checksum
 * length; the modulus is then S^length instead of the profile default.
 */
export function checksumValue(profile, body, bodyIndex, checksumLength = profile.checksumLength) {
    const modulus = checksumLength === profile.checksumLength
        ? profile.checksumModulus
        : powBigInt(BigInt(profile.checksumAlphabetNorm.length || 1), checksumLength);
    let state = 17n;
    for (let i = 0; i < profile.profileId.length; i += 1) {
        state = (state * 37n + BigInt(profile.profileId.charCodeAt(i)) + 1n) % modulus;
    }
    state = (state * 37n) % modulus;
    for (let pos = 0; pos < body.length; pos += 1) {
        const symValue = bodyIndex.get(body[pos]);
        if (symValue === undefined) {
            throw new BasehError("INVALID_CHARACTER", `Body symbol ${JSON.stringify(body[pos])} is not in the body alphabet`);
        }
        state = (state * 37n + symValue + BigInt(pos + 1)) % modulus;
    }
    return state;
}
/** Compute the expected checksum string for a normalized body. */
export function calculateChecksum(profile, body, checksumLength = profile.checksumLength) {
    if (checksumLength === 0)
        return "";
    const index = alphabetIndex(profile.bodyAlphabetNorm);
    const value = checksumValue(profile, body, index, checksumLength);
    return encodeBaseN(value, profile.checksumAlphabetNorm, checksumLength);
}
function powBigInt(base, exp) {
    let result = 1n;
    for (let i = 0; i < exp; i += 1)
        result *= base;
    return result;
}
