import { Baseh } from "./codec.js";
import { basehMediumV1 } from "./profiles.js";

/**
 * Zero-config pair over the frozen baseh-medium-v1 profile. No profile
 * object, no key: just the two functions an application needs when it
 * does not want to think about configuration.
 *
 *   toCode(id)   -> "7KM4Q2H"
 *   fromCode(code) -> id
 *
 * toCode accepts a bigint, a safe integer number or a decimal string.
 * fromCode strips every whitespace character (edges and internal),
 * accepts lowercase and the typed aliases (O, I, L) and returns the id
 * as a bigint. Any invalid input throws BasehError, including the rare
 * BLOCKED_CODE identifiers that spell a blocklisted word; no correction
 * attempts are ever made.
 */

const ZERO = new Baseh(basehMediumV1());

function toBigInt(id: bigint | number | string): bigint {
  if (typeof id === "bigint") return id;
  if (typeof id === "number") {
    if (!Number.isSafeInteger(id) || id < 0) {
      throw new TypeError("toCode expects a non-negative safe integer, bigint or decimal string");
    }
    return BigInt(id);
  }
  if (typeof id === "string" && /^[0-9]+$/.test(id)) return BigInt(id);
  throw new TypeError("toCode expects a non-negative safe integer, bigint or decimal string");
}

/** Encode an identifier with the zero-config Medium profile. */
export function toCode(id: bigint | number | string): string {
  return ZERO.encode(toBigInt(id));
}

/** Decode a code from the zero-config Medium profile back to its identifier. */
export function fromCode(code: string): bigint {
  return ZERO.decode(code.replace(/\s+/g, "")).id;
}
