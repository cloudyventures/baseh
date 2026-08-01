import type { BasehProfile } from "./profile.js";
export interface FrozenKeyOptions {
    keyBytes: Uint8Array;
    keyId?: string;
    rounds?: number;
}
/** Alphanumeric, no safety strips, no checksum, hyphen-delimited XXX-XXX. */
export declare function basehMinimumV1(): BasehProfile;
/** baseh-minimum with feistel-v1 permutation. */
export declare function basehMinimumPV1(options: FrozenKeyOptions): BasehProfile;
/** Visual light plus spoken light, one checksum symbol. */
export declare function basehLightV1(): BasehProfile;
/** baseh-light with feistel-v1 permutation. */
export declare function basehLightPV1(options: FrozenKeyOptions): BasehProfile;
/** Visual medium plus spoken medium, one checksum symbol. The default. */
export declare function basehMediumV1(): BasehProfile;
/** baseh-medium with feistel-v1 permutation. */
export declare function basehMediumPV1(options: FrozenKeyOptions): BasehProfile;
/** Conservative alphabet plus spoken heavy, one checksum symbol. */
export declare function basehHeavyV1(): BasehProfile;
/** baseh-heavy with feistel-v1 permutation. */
export declare function basehHeavyPV1(options: FrozenKeyOptions): BasehProfile;
