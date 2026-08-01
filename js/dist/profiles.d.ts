import type { BasehProfile } from "./profile.js";
/**
 * The frozen published permutation key. Public by design: it makes issued
 * codes look non-sequential but offers no secrecy, since anyone can read it
 * here. Never swap it on a live namespace; codes only decode with the key
 * they were issued under. Use the -p variants to supply private key material.
 */
export declare const FROZEN_KEY_BYTES: Uint8Array;
export interface FrozenKeyOptions {
    keyBytes: Uint8Array;
    keyId?: string;
    rounds?: number;
}
/** Alphanumeric, no safety strips, no checksum, hyphen-delimited XXX-XXX. */
export declare function basehMinimumV1(): BasehProfile;
/** baseh-minimum permuted with caller-supplied key material. */
export declare function basehMinimumPV1(options: FrozenKeyOptions): BasehProfile;
/** Visual light plus spoken light, two checksum symbols, hyphen-delimited. */
export declare function basehLightV1(): BasehProfile;
/** baseh-light permuted with caller-supplied key material. */
export declare function basehLightPV1(options: FrozenKeyOptions): BasehProfile;
/** Visual medium plus spoken medium, two checksum symbols, hyphen-delimited. The default. */
export declare function basehMediumV1(): BasehProfile;
/** baseh-medium permuted with caller-supplied key material. */
export declare function basehMediumPV1(options: FrozenKeyOptions): BasehProfile;
/** Conservative alphabet plus spoken heavy, two checksum symbols, hyphen-delimited. */
export declare function basehHeavyV1(): BasehProfile;
/** baseh-heavy permuted with caller-supplied key material. */
export declare function basehHeavyPV1(options: FrozenKeyOptions): BasehProfile;
