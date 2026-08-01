# baseH Round-Trip Soak Test Suite

## 1. Purpose

This document defines a long-running round-trip soak suite: encode every id
in a range, decode the result, and assert the decoded id equals the input.
It complements the unit, property and vector suites in
`IMPLEMENTATION_TEST_SUITE.md` by exercising the codec — including the
Feistel permutation, repetition filter, blocklist and expandable generation
boundaries — across hundreds of millions of ids.

The suite runs on macOS and Linux in all five implementations (TypeScript,
Python, Go, Rust, Ruby) with the same shape everywhere. Round trips are
self-verifying, so no cross-language golden vectors are required.

## 2. Profiles under test

Every shipped tier, in two variants:

1. **Permutation on** — the profile exactly as shipped.
2. **Permutation off** — a test-only twin with the permutation disabled,
   mirroring the twin-profile pattern already used by the repetition tests.

| Profile | Mode | Sweep bound (soak) |
|---|---|---:|
| `baseh-minimum-v1` / `-p` | fixed | 1,000,000,000 |
| `baseh-light-v1` / `-p` | fixed | capacity (887,503,681) |
| `baseh-medium-v1` / `-p` | fixed | capacity (481,890,304) |
| `baseh-heavy-v1` / `-p` | fixed | capacity (308,915,776) |
| `baseh-expandable-v1` / `-p` | expandable | 1,000,000,000 |

Fixed tiers sweep to `min(1e9, capacity)`: three of them cannot reach a
billion, so their bound is their capacity — the sweep is exhaustive over the
entire issuable namespace of every fixed tier except Minimum.

Keyed `-p` variants use a fixed test key, recorded in the suite as
hexadecimal, per the key-handling rule of the vector suite (test keys in
tests, never in shipped profiles).

## 3. Sweep phase

For each profile and variant:

```text
for id in 0 .. sweepBound:
    result = encode(id)
    if result is BLOCKED_CODE:
        blockedCount += 1          # repetition filter or blocklist; expected, not a failure
        continue
    decoded = decode(result.code)
    assert decoded.id == id
```

Rules:

- `BLOCKED_CODE` from the repetition filter or profanity blocklist is an
  expected outcome, not a failure. The suite counts blocked ids and reports
  the count per profile.
- Any other encode error, any decode error, or any id mismatch is a hard
  failure: report the profile, the first failing id, its encoded code (if
  any), and stop that profile's sweep. Other profiles continue.
- Progress is logged periodically (ids checked, throughput, blocked count)
  so long runs are observable.

## 4. Random phase

Expandable profiles only — fixed tiers cannot hold ids at this scale.

```text
for i in 0 .. randomCount:          # default 1,000,000, configurable
    id = random in [1,000,000,000, 100,000,000,000)
    assert decode(encode(id)).id == id
```

Rules:

- The generator is seeded; the seed is fixed per run and printed at start so
  a failure is reproducible. Each language uses its own PRNG — round trips
  are self-verifying, so streams need not match across languages.
- The same range runs against both permutation variants of
  `baseh-expandable-v1` and `baseh-expandable-p-v1`.

## 5. Packaging: CI subset and full soak

The same code backs two run levels, selected per language by its native
long-test convention:

- **CI subset (default)** — sweep capped at 100,000 per profile and
  10,000 random samples. Runs in seconds inside the existing test runner:
  vitest (`js`), pytest (`python`), `go test` (`go`),
  `cargo test` (`rust`), rake/minitest (`ruby`). Gated like any other test.
- **Full soak (opt-in)** — the bounds of sections 3 and 4. Selected by an
  environment variable `BASEH_SOAK=1` mapped to the language's idiom (Go
  `testing.Short()` inverse or a `soak` build tag, a pytest marker, a
  vitest `describe.skipIf`, a cargo `--ignored` test, a minitest skip). The
  soak is never part of default CI; it is run on demand before releases.

## 6. Failure reporting

Per profile, on completion or first failure:

```text
profile, variant, phase, ids checked, blocked count, elapsed, throughput,
first failure (id, code, stage, error) if any
```

A mismatch report must be enough to reproduce: profile ID, variant, seed
(random phase), and the failing id.

## 7. Feasibility notes

- A billion round trips is feasible in Go and Rust (well under an hour at
  the performance budgets of `IMPLEMENTATION_TEST_SUITE.md` section 17).
  TypeScript, Python and Ruby are slower; expect hours for the slowest.
  This is acceptable because the soak is opt-in, and throughput logging
  makes runtime visible early. Implementations may parallelize the sweep by
  sharding the id range, since each round trip is independent.
- Expandable sweep to 1e9 crosses many generation boundaries (the tier
  starts at 4 symbols and grows), so the sweep doubles as generation-boundary
  coverage beyond the pinned boundary vectors of the test suite.

## 8. Out of scope

- Cross-language golden vectors for the soak (self-verifying by design).
- Timing benchmarks as pass/fail gates — throughput is reported, not asserted.
- Correction, fuzz and alias behavior — covered by existing layers.
