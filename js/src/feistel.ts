import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { HrcError } from "./errors.js";

const TAG = new TextEncoder().encode("HRC-FEISTEL-V1");
const MAX_WALKS = 1000;

interface FeistelKey {
  profileId: string;
  keyBytes: Uint8Array;
  rounds: number;
}

function bitLength(capacity: bigint): number {
  return (capacity - 1n).toString(2).length;
}

/** Low n bits of the HMAC-SHA-256 digest, per spec 7.3. */
function lowBits(digest: Uint8Array, n: number): bigint {
  const byteCount = Math.ceil(n / 8);
  let v = 0n;
  for (let i = 0; i < byteCount; i += 1) {
    v = (v << 8n) | BigInt(digest[i] as number);
  }
  return v & ((1n << BigInt(n)) - 1n);
}

function toBe(value: bigint, byteCount: number): Uint8Array {
  const out = new Uint8Array(byteCount);
  let v = value;
  for (let i = byteCount - 1; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function roundMessage(profileId: string, round: number, right: bigint, wr: number): Uint8Array {
  const pidBytes = new TextEncoder().encode(profileId);
  const rightBytes = toBe(right, Math.ceil(wr / 8));
  const msg = new Uint8Array(TAG.length + 1 + pidBytes.length + 1 + 1 + rightBytes.length);
  let o = 0;
  msg.set(TAG, o); o += TAG.length;
  msg[o] = 0; o += 1;
  msg.set(pidBytes, o); o += pidBytes.length;
  msg[o] = 0; o += 1;
  msg[o] = round; o += 1;
  msg.set(rightBytes, o);
  return msg;
}

interface Halves {
  left: bigint;
  right: bigint;
}

function runRounds(h: Halves, key: FeistelKey, w0: number, w1: number): Halves {
  let { left, right } = h;
  for (let i = 0; i < key.rounds; i += 1) {
    const even = i % 2 === 0;
    const wr = even ? w1 : w0;
    const wl = even ? w0 : w1;
    const digest = hmac(sha256, key.keyBytes, roundMessage(key.profileId, i, right, wr));
    const f = lowBits(digest, wl);
    const newLeft = right;
    const newRight = left ^ f;
    left = newLeft;
    right = newRight;
  }
  return { left, right };
}

function runInverse(h: Halves, key: FeistelKey, w0: number, w1: number): Halves {
  let { left, right } = h;
  for (let i = key.rounds - 1; i >= 0; i -= 1) {
    const even = i % 2 === 0;
    const wr = even ? w1 : w0;
    const wl = even ? w0 : w1;
    const digest = hmac(sha256, key.keyBytes, roundMessage(key.profileId, i, left, wr));
    const f = lowBits(digest, wl);
    const prevRight = left;
    const prevLeft = right ^ f;
    left = prevLeft;
    right = prevRight;
  }
  return { left, right };
}

function combine(h: Halves, w1: number): bigint {
  return (h.left << BigInt(w1)) | h.right;
}

function split(value: bigint, w1: number): Halves {
  return { left: value >> BigInt(w1), right: value & ((1n << BigInt(w1)) - 1n) };
}

/** Spec 7.3 forward permutation with cycle walking. */
export function permute(value: bigint, capacity: bigint, key: FeistelKey): bigint {
  const bits = bitLength(capacity);
  const w1 = Math.floor(bits / 2);
  const w0 = bits - w1;
  let v = value;
  for (let walk = 0; walk < MAX_WALKS; walk += 1) {
    const out = combine(runRounds(split(v, w1), key, w0, w1), w1);
    if (out < capacity) return out;
    v = out;
  }
  throw new HrcError("PERMUTATION_FAILURE", "Feistel cycle walking exceeded 1000 iterations", false);
}

/** Spec 7.3 inverse permutation with cycle walking. */
export function inversePermute(value: bigint, capacity: bigint, key: FeistelKey): bigint {
  const bits = bitLength(capacity);
  const w1 = Math.floor(bits / 2);
  const w0 = bits - w1;
  let v = value;
  for (let walk = 0; walk < MAX_WALKS; walk += 1) {
    const out = combine(runInverse(split(v, w1), key, w0, w1), w1);
    if (out < capacity) return out;
    v = out;
  }
  throw new HrcError("PERMUTATION_FAILURE", "Feistel cycle walking exceeded 1000 iterations", false);
}
