/**
 * Committed, runnable-on-demand benchmark for the expandable v1 hot path,
 * matching the Go/Rust benchmarks. Not part of CI.
 * Run from js/: npm run bench
 */
import { performance } from "node:perf_hooks";
import { Baseh, basehExpandableV1 } from "../src/index.js";

const WARMUP = 1_000;
const ITERS = 10_000;

function bench(label: string, fn: () => void): void {
  for (let i = 0; i < WARMUP; i++) fn();
  const start = performance.now();
  for (let i = 0; i < ITERS; i++) fn();
  const elapsedMs = performance.now() - start;
  const opsPerSec = (ITERS / elapsedMs) * 1000;
  console.log(`${label}: ${opsPerSec.toFixed(0)} ops/sec (${((elapsedMs * 1e6) / ITERS).toFixed(0)} ns/op, ${ITERS} iters)`);
}

const h = new Baseh(basehExpandableV1());
const id = 123456789n;
const code = h.encode(id);

bench("encode", () => { h.encode(id); });
bench("decode", () => { h.decode(code); });
