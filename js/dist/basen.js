import { HrcError } from "./errors.js";
/** Spec 5.1. Fixed-length base-N encode, most significant digit first. */
export function encodeBaseN(value, alphabet, length) {
    const base = BigInt(alphabet.length);
    const out = new Array(length);
    let v = value;
    for (let pos = length - 1; pos >= 0; pos -= 1) {
        const digit = Number(v % base);
        const ch = alphabet[digit];
        if (ch === undefined)
            throw new HrcError("OUT_OF_RANGE", "digit outside alphabet");
        out[pos] = ch;
        v = v / base;
    }
    return out.join("");
}
/** Spec 5.2. */
export function decodeBaseN(text, alphabet, index) {
    const base = BigInt(alphabet.length);
    let value = 0n;
    for (const ch of text) {
        const digit = index.get(ch);
        if (digit === undefined) {
            throw new HrcError("INVALID_CHARACTER", `Symbol ${JSON.stringify(ch)} is not in the alphabet`);
        }
        value = value * base + digit;
    }
    return value;
}
export function alphabetIndex(alphabet) {
    const m = new Map();
    [...alphabet].forEach((ch, i) => m.set(ch, BigInt(i)));
    return m;
}
