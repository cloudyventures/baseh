/** Error codes defined by the HRC codec specification. */
export type HrcErrorCode = "INVALID_PROFILE" | "OUT_OF_RANGE" | "PERMUTATION_FAILURE" | "INVALID_LENGTH" | "INVALID_CHARACTER" | "INVALID_CHECKSUM" | "AMBIGUOUS_INPUT" | "TOO_MANY_CANDIDATES";
export declare class HrcError extends Error {
    readonly code: HrcErrorCode;
    /** True when the message may be shown to an end user unchanged. */
    readonly safeForCustomer: boolean;
    constructor(code: HrcErrorCode, message: string, safeForCustomer?: boolean);
}
