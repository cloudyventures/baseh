export class HrcError extends Error {
    code;
    /** True when the message may be shown to an end user unchanged. */
    safeForCustomer;
    constructor(code, message, safeForCustomer = true) {
        super(message);
        this.name = "HrcError";
        this.code = code;
        this.safeForCustomer = safeForCustomer;
    }
}
