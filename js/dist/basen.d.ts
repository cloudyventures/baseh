/** Spec 5.1. Fixed-length base-N encode, most significant digit first. */
export declare function encodeBaseN(value: bigint, alphabet: string, length: number): string;
/** Spec 5.2. */
export declare function decodeBaseN(text: string, alphabet: string, index: Map<string, bigint>): bigint;
export declare function alphabetIndex(alphabet: string): Map<string, bigint>;
