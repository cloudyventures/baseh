interface FeistelKey {
    profileId: string;
    keyBytes: Uint8Array;
    rounds: number;
}
/** Spec 7.3 forward permutation with cycle walking. */
export declare function permute(value: bigint, capacity: bigint, key: FeistelKey): bigint;
/** Spec 7.3 inverse permutation with cycle walking. */
export declare function inversePermute(value: bigint, capacity: bigint, key: FeistelKey): bigint;
export {};
