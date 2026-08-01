import type { PreparedProfile } from "./profile.js";
import { BasehError } from "./errors.js";
import { alphabetIndex, encodeBaseN, powBigInt } from "./basen.js";

/**
 * Spec 6.2. Rolling polynomial checksum over symbol values.
 * Returns the checksum value in [0, modulus).
 * Spec 22: expandable generations may pass a shorter effective checksum
 * length; the modulus is then S^length instead of the profile default.
 */
export function checksumValue(
  profile: PreparedProfile,
  body: string,
  bodyIndex: Map<string, bigint>,
  checksumLength = profile.checksumLength
): bigint {
  const modulus =
    checksumLength === profile.checksumLength
      ? profile.checksumModulus
      : powBigInt(BigInt(profile.checksumAlphabetNorm.length || 1), checksumLength);
  let state = 17n;
  for (let i = 0; i < profile.profileId.length; i += 1) {
    state = (state * 37n + BigInt(profile.profileId.charCodeAt(i)) + 1n) % modulus;
  }
  state = (state * 37n) % modulus;
  for (let pos = 0; pos < body.length; pos += 1) {
    const symValue = bodyIndex.get(body[pos] as string);
    if (symValue === undefined) {
      throw new BasehError(
        "INVALID_CHARACTER",
        `Body symbol ${JSON.stringify(body[pos])} is not in the body alphabet`
      );
    }
    state = (state * 37n + symValue + BigInt(pos + 1)) % modulus;
  }
  return state;
}

/** Compute the expected checksum string for a normalized body. */
export function calculateChecksum(
  profile: PreparedProfile,
  body: string,
  checksumLength = profile.checksumLength,
  bodyIndex?: Map<string, bigint>
): string {
  if (checksumLength === 0) return "";
  // Correction loops call this up to 64 times; callers with a prepared index
  // pass it in rather than rebuilding one per call.
  const index = bodyIndex ?? alphabetIndex(profile.bodyAlphabetNorm);
  const value = checksumValue(profile, body, index, checksumLength);
  return encodeBaseN(value, profile.checksumAlphabetNorm, checksumLength);
}
