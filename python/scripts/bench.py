"""Committed, runnable-on-demand benchmark for the expandable v1 hot path,
matching the Go/Rust benchmarks. Not part of CI; not packaged (setuptools
only discovers packages under src/).

Run from python/:  PYTHONPATH=src python3 scripts/bench.py
"""
import time

from baseh import Baseh, baseh_expandable_v1

WARMUP = 1_000
ITERS = 10_000


def bench(label, fn):
    for _ in range(WARMUP):
        fn()
    start = time.perf_counter()
    for _ in range(ITERS):
        fn()
    elapsed = time.perf_counter() - start
    ops_per_sec = ITERS / elapsed
    print(f"{label}: {ops_per_sec:.0f} ops/sec ({elapsed / ITERS * 1e9:.0f} ns/op, {ITERS} iters)")


h = Baseh(baseh_expandable_v1())
id_ = 123456789
code = h.encode(id_)

bench("encode", lambda: h.encode(id_))
bench("decode", lambda: h.decode(code))
