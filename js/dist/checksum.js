import { alphabetIndex, encodeBaseN } from "./basen.js";
/**
 * Spec 6.2. Rolling polynomial checksum over symbol values.
 * Returns the checksum value in [0, modulus).
 */
export function checksumValue(profile, body, bodyIndex) {
    const modulus = profile.checksumModulus;
    let state = 17n;
    for (let i = 0; i < profile.profileId.length; i += 1) {
        state = (state * 37n + BigInt(profile.profileId.charCodeAt(i)) + 1n) % modulus;
    }
    state = (state * 37n) % modulus;
    for (let pos = 0; pos < body.length; pos += 1) {
        const symValue = bodyIndex.get(body[pos]);
        state = (state * 37n + symValue + BigInt(pos + 1)) % modulus;
    }
    return state;
}
/** Compute the expected checksum string for a normalized body. */
export function calculateChecksum(profile, body) {
    if (profile.checksumLength === 0)
        return "";
    const index = alphabetIndex(profile.bodyAlphabetNorm);
    const value = checksumValue(profile, body, index);
    return encodeBaseN(value, profile.checksumAlphabetNorm, profile.checksumLength);
}
