import type { PreparedProfile } from "./profile.js";
/**
 * Spec 6.2. Rolling polynomial checksum over symbol values.
 * Returns the checksum value in [0, modulus).
 * Spec 22: expandable generations may pass a shorter effective checksum
 * length; the modulus is then S^length instead of the profile default.
 */
export declare function checksumValue(profile: PreparedProfile, body: string, bodyIndex: Map<string, bigint>, checksumLength?: number): bigint;
/** Compute the expected checksum string for a normalized body. */
export declare function calculateChecksum(profile: PreparedProfile, body: string, checksumLength?: number): string;
