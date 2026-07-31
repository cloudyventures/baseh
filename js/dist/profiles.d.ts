import type { HrcProfile } from "./profile.js";
interface FrozenOptions {
    keyBytes: Uint8Array;
    keyId: string;
    rounds?: number;
}
/**
 * Frozen profile hrc32-v1: 6 body + 1 checksum, feistel-v1 permutation.
 * Assisted-support use. Structured single-substitution miss rate about 1.4%
 * per position; see spec 6.3.
 */
export declare function hrc32V1(options: FrozenOptions): HrcProfile;
/**
 * Frozen profile hrc32s-v1: 6 body + 2 checksum, feistel-v1 permutation.
 * Self-service use. Provably detects all single-symbol substitutions and
 * all adjacent transpositions; see spec 6.3.
 */
export declare function hrc32sV1(options: FrozenOptions): HrcProfile;
/** Published demo key for the browser tools. Never use in a real application. */
export declare const DEMO_KEY_ID = "demo-01";
export declare const DEMO_KEY_BYTES: Uint8Array<ArrayBuffer>;
export {};
