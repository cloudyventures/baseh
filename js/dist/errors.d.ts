/** Error codes defined by the baseH codec specification. */
export type BasehErrorCode = "INVALID_PROFILE" | "OUT_OF_RANGE" | "PERMUTATION_FAILURE" | "INVALID_LENGTH" | "INVALID_CHARACTER" | "INVALID_CHECKSUM" | "AMBIGUOUS_INPUT" | "TOO_MANY_CANDIDATES" | "BLOCKED_CODE";
export declare class BasehError extends Error {
    readonly code: BasehErrorCode;
    /** True when the message may be shown to an end user unchanged. */
    readonly safeForCustomer: boolean;
    constructor(code: BasehErrorCode, message: string, safeForCustomer?: boolean);
}
