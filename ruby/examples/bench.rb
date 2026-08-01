# frozen_string_literal: true

# Committed, runnable-on-demand benchmark for the expandable v1 hot path,
# matching the Go/Rust benchmarks. Not part of CI.
# Run from ruby/:  ruby -I lib examples/bench.rb

require "baseh"

WARMUP = 1_000
ITERS = 10_000

def bench(label)
  WARMUP.times { yield }
  start = Process.clock_gettime(Process::CLOCK_MONOTONIC)
  ITERS.times { yield }
  elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - start
  ops_per_sec = ITERS / elapsed
  puts format("%s: %.0f ops/sec (%.0f ns/op, %d iters)", label, ops_per_sec, elapsed / ITERS * 1e9, ITERS)
end

h = Baseh::Baseh.new(Baseh.baseh_expandable_v1)
id = 123456789
code = h.encode(id: id)

bench("encode") { h.encode(id: id) }
bench("decode") { h.decode(code) }
