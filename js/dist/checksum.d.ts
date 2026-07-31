import type { PreparedProfile } from "./profile.js";
/**
 * Spec 6.2. Rolling polynomial checksum over symbol values.
 * Returns the checksum value in [0, modulus).
 */
export declare function checksumValue(profile: PreparedProfile, body: string, bodyIndex: Map<string, bigint>): bigint;
/** Compute the expected checksum string for a normalized body. */
export declare function calculateChecksum(profile: PreparedProfile, body: string): string;
