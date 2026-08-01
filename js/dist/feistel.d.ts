interface FeistelKey {
    profileId: string;
    keyBytes: Uint8Array;
    rounds: number;
    /**
     * Expandable mode only (spec 7.3/19.4): the total code length L of the
     * generation, mixed into the round message. Absent in fixed mode, where
     * the message stays byte-for-byte unchanged.
     */
    length?: number;
}
/** Spec 7.3 forward permutation with cycle walking. */
export declare function permute(value: bigint, capacity: bigint, key: FeistelKey): bigint;
/** Spec 7.3 inverse permutation with cycle walking. */
export declare function inversePermute(value: bigint, capacity: bigint, key: FeistelKey): bigint;
export {};
