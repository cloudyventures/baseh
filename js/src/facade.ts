import { Baseh, type DecodeOptions, type DecodeResult, type ValidateResult } from "./codec.js";
import { basehExpandableV1 } from "./profiles.js";

/**
 * Zero-config facade over the shipped expandable v1 default profile. Most
 * callers never need to touch a profile object: `encode(id)` and
 * `decode(code)` here behave exactly like the same methods on a
 * `new Baseh(basehExpandableV1())` instance, sharing one lazily constructed
 * instance for the process.
 */
let shared: Baseh | undefined;

function sharedInstance(): Baseh {
  shared ??= new Baseh(basehExpandableV1());
  return shared;
}

/** Encode an id with the default expandable v1 profile. */
export function encode(id: bigint | number): string {
  return sharedInstance().encode(id);
}

/** Decode a code with the default expandable v1 profile. Throws BasehError like the instance API. */
export function decode(input: string, options: DecodeOptions = {}): DecodeResult {
  return sharedInstance().decode(input, options);
}

/** Validate a code with the default expandable v1 profile. Never throws on user input. */
export function validate(input: string, options: DecodeOptions = {}): ValidateResult {
  return sharedInstance().validate(input, options);
}
