export { BasehError } from "./errors.js";
export type { BasehErrorCode } from "./errors.js";
export type { BasehProfile, BasehPermutation, PreparedProfile } from "./profile.js";
export { prepareProfile } from "./profile.js";
export {
  Baseh,
  normalize,
  formatRaw,
  generateCandidates,
  CONFUSION_MAPS
} from "./codec.js";
export type { DecodeOptions, DecodeResult, ValidateResult, ConfusionProfileName } from "./codec.js";
export { encodeBaseN, decodeBaseN, alphabetIndex } from "./basen.js";
export { calculateChecksum, checksumValue } from "./checksum.js";
export { permute, inversePermute } from "./feistel.js";
export { baseh32V1, baseh32sV1 } from "./profiles.js";
export { DEFAULT_BLOCKLIST, effectiveBlocklist, stripVowels } from "./blocklist.js";
export type { BasehProfanity, BasehProfanityMode } from "./blocklist.js";
