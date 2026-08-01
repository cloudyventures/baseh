# baseH code review

An external readiness review of the baseH codec, tools and release
process, run before the first public release. Findings are prioritized by
what an open-source audience will hit first. Each item carries a severity,
a concrete location and a recommended fix.

The headline: the engineering that matters most, the codec itself across all
five ports, is sound. The frozen profiles, checksum, Feistel permutation,
expandable-generation math and repetition filter are byte-for-byte identical
in TypeScript, Python, Ruby, Rust and Go, and all five test against one
shared vector file with no vendored copies. The exposure is around that
core: repo hygiene, the web tools, the untested non-frozen paths and the
gap between the aspirational test spec and what CI actually enforces.

## P0 - fix before any public release

### 1. Committed dependencies and build artifacts

633 `node_modules` files and all 20 `js/dist/*` build outputs are tracked in
HEAD. They were committed in the very first commit (`c0a623a`) and never
removed, even though `.gitignore` lists both `node_modules/` and `dist/`.
The release workflow rebuilds `dist` from source, so the tracked copies are
also stale by design.

This is the first thing any reviewer checks and the loudest "first OSS
project" signal in the repo.

Fix: `git rm -r --cached js/node_modules js/dist`, leave the `.gitignore`
entries, rebuild `dist` in the publish job (already done). The committed
`js/package-lock.json` is correct and should stay.

### 2. The web tools ship to the public site untested

`.github/workflows/pages.yml` deploys `web/dist` to GitHub Pages on every
push to `main` touching `web/**` or `js/**`. It runs `vite build` only.
Vite uses esbuild, which strips TypeScript types without checking them, so a
type error does not block the build. It runs no `npm test` and does not
depend on the `ci.yml` `web` job. A failing test or a type error goes live
to a public site. This also breaks the project's own "main is gated" rule.

Fix: make `pages.yml` depend on `ci.yml` (via `workflow_run` or a `needs`
chain), and add `npm test` plus `tsc --noEmit` to the build step.

### 3. XSS in the calculator

`web/src/calculator.ts:168` builds `els.examplesBody.innerHTML` with a
template that interpolates `e.code` directly. Custom-alphabet mode accepts
any ASCII printable character (`web/index.html:50`, `web/src/core.ts:294`),
and alphabet validation at `core.ts:496` only rejects non-ASCII, so `<`,
`>`, `&`, `"` and `'` all pass. A custom alphabet such as `<>&a` produces
codes the browser parses as HTML inside the `innerHTML` assignment.

It is self-XSS today (the malicious alphabet is not carried in share-URL
params, so it cannot be triggered via a link), but it is unescaped
user-controlled input in `innerHTML` in a tool marketed as
security-conscious. The user-typed separator reaches `innerHTML` via the
repair and problems text too (`calculator.ts:193`, `web/src/designer.ts:195`).

Safe paths confirmed: `web/src/try-list.ts` uses `textContent` and
`document.createElement` throughout, and the conversion outputs build safe
DOM nodes. The designer only uses fixed alphabets, so its `innerHTML` paths
are not currently reachable with user-controlled HTML.

Fix: escape `e.code` (and `e.id` for symmetry) before interpolation, or
build the example rows with DOM APIs as the conversion outputs already do.
Escape the user separator in the repair and problems text. Add a Content
Security Policy meta tag (`default-src 'self'; script-src 'self'`) to both
HTML files.

### 4. Algorithmic DoS on `encode(hugeInt)` for expandable profiles

`generationForId` loops with no ceiling; the `L > 32` guard runs only after
the loop returns. For an adversarial id (`10**100000`) the loop runs roughly
600,000 iterations of big-integer multiplication on exponentially growing
values before the caller rejects.

- Python `python/src/baseh/codec.py:152-161`: measured ~1.5s for `10**100000`
  and a timeout for `10**1000000`. The zero-config `to_code(int)` and direct
  `Baseh.encode(int)` are both exposed.
- JavaScript `js/src/codec.ts:157-167` (`generationForId`): same shape.
- Go `go/codec.go:470-482`: same shape.

On top of the loop, Python 3.11's int-to-str 4300-digit limit means the
error message at `codec.py:264` (`f"ID {id} requires a code longer than 32
symbols"`) throws `ValueError: Exceeds the limit (4300 digits)` out of the
public API instead of `BasehError(OUT_OF_RANGE)`. None of this is caught by
the current fuzz tests.

Fix: cap the loop at `33 - minLength` iterations (or pre-check
`id >= generationBase(profile, 33)`) and return `OUT_OF_RANGE` from inside.
In Python, do not embed the raw id in the error message, or truncate it.

### 5. Public-API panics in Rust

- `rust/src/codec.rs:353-357`: `capacity()` uses `assert!` (panic) for an
  expandable profile where the JS reference throws a catchable
  `BasehError("INVALID_PROFILE")`. The test `capacity_is_fixed_mode_only`
  bakes the panic in with `#[should_panic]`. Should return
  `Result<&BigUint, BasehError>`.
- `rust/src/zero.rs:70-74`: `decimal_to_biguint` panics on a user-supplied
  non-digit string. `to_code` is public and accepts `&str`. A bad string
  panics the caller. JS throws a catchable `TypeError`. Should return a
  `BasehError` and be folded into the existing `Result`.
- `rust/src/feistel.rs:81,193-212`: `permute` and `inverse_permute` are
  exported via `pub mod feistel` and accept any `u32` for `rounds`. Inside
  `round_message`, the round number is cast `round as u8`, so `rounds = 256`
  makes round 0 and round 256 produce identical messages, silently breaking
  the permutation. Profile validation caps rounds at 4-16, but the public
  `feistel` module bypasses that. Either validate inside `permute` or make
  the module private.

## P1 - correctness drift and broken contracts

### 6. Multi-character separators diverge across implementations

Frozen tiers all use `"-"` so the shared vectors pass, but the non-frozen
path disagrees:

- JavaScript `js/src/codec.ts:46`: `s.split(separator).join("")` (literal
  substring), and `codec.ts:345` splits on the separator string for the
  `corrected` flag.
- Ruby `ruby/lib/baseh/baseh.rb:267,457`: `s.delete(separator)`, which
  interprets its argument as a character class, not a literal substring. A
  separator such as `".."` or `"X-"` corrupts decoding. `canonical_raw`
  has the same bug.
- Rust `rust/src/codec.rs:605-608`: filters individual characters
  (`filter(|c| !separator.contains(*c))`), which diverges from JS for any
  multi-character separator.

Fix: standardize on literal-substring removal (`gsub` in Ruby, `replace`
in Python, etc.) and add a shared vector with a multi-character separator.

### 7. Same input, different behavior across ports on the option fields

- `minLength: 0`: Rust coerces silently to 4 (`rust/src/profile.rs:214-218`,
  using `0` as a default sentinel because the struct uses `usize` not
  `Option<usize>`). JS rejects 0 (`js/src/profile.ts:146-148`). Python raises
  `TypeError` on a non-int value (`python/src/baseh/profile.py:97-102,275`).
- `maxCorrections: 0`: Go silently coerces 0 to 1
  (`go/codec.go:202-204`) because the zero value cannot be distinguished
  from an explicit 0, so the field is dead code that lies about supporting
  `0`. The spec API is `maxCorrections?: 0 | 1`.

These are exactly the cross-language inconsistencies the spec's "stable
behaviour across implementations" goal exists to prevent.

Fix: use `Option<usize>` for `min_length` in Rust (or reject 0 explicitly);
use `*int` for `MaxCorrections` in Go (or drop the field and gate on
`TryCorrection` alone); validate `maxCorrections` to `0 | 1` at every
API boundary.

### 8. Spec and docs contradict the shipped code

- `README.md:196-205` says expandable mode "is the headline of the next
  release" and "the `baseh-expandable-v1` helpers will not exist in
  published packages until then." All five ports ship the helpers
  (`js/src/profiles.ts:203`, `python/src/baseh/profiles.py:181`,
  `ruby/lib/baseh/profiles.rb:138`, `rust/src/profiles.rs:210`,
  `go/profiles.go:253`) and test against expandable vectors. The paragraph
  should be deleted or rewritten.
- `spec/IMPLEMENTATION_TEST_SUITE.md` section 5 ("Default profile boundary
  tests") says the default is 32 symbols, length 6, capacity 1,073,741,824.
  No shipped frozen tier is 32 symbols (minimum 36, light 31, medium 28,
  heavy 26). The numbers describe the synthetic `baseh32-*` test profiles,
  not a default; the section title is wrong.
- `spec/IMPLEMENTATION_CODEC.md` section 7.3 says `"BASEH-FEISTEL-V1"` is
  "14 ASCII bytes" but the string is 16 bytes. Implementations use the
  literal and agree, so this is a doc typo, not drift.
- `python/pyproject.toml:7` is `version = "2.0.0"` while
  `python/src/baseh/__init__.py:82` is `__version__ = "1.0.0"`.
  `importlib.metadata.version("baseh")` and `baseh.__version__` disagree.

### 9. `validate()` leaks non-`BasehError` exceptions (Python)

`python/src/baseh/codec.py:323-325` raises a plain `ValueError` for an
unknown `confusion_profile`. `validate()` at `codec.py:388` only catches
`BasehError`, so the `ValueError` escapes. Confirmed:
`codec.validate("C8XP-8J4X", try_correction=True, confusion_profile="bogus")`
raises an uncaught `ValueError`. The spec says `validate` must "never raise
on user input."

A non-string `decode` input is reported as `INVALID_CHARACTER`
(`codec.py:51`) rather than a `TypeError`, which is semantically wrong and
gets swallowed by `validate()` as a user-facing "invalid character" result.

Fix: raise `BasehError(INVALID_PROFILE, ...)` for a bad confusion profile
(or validate the option before the try block), and raise `TypeError` for
non-string input.

### 10. No strict mode, but the spec and test-suite assume one

`js/src/codec.ts:46` (and the equivalent in every port) strips the
configured separator everywhere, so double separators and wrong-position
separators are silently accepted. Spec section 11 ("reject unexpected
punctuation unless the caller explicitly enables lenient mode") and
test-suite section 8 ("rejects double separators in strict mode", "rejects
wrong separator in strict mode") both assume a strict/lenient mode that
does not exist in any implementation's `DecodeOptions`.

Fix: either add a `strict` option and enforce separator positions, or
remove the strict-mode language from the spec and test-suite and document
the lenient-by-default behavior.

## P1 - process: the conformance story is weaker than it looks

### 11. The 100k-substitution checksum sweep is a release gate implemented by zero of five

`spec/IMPLEMENTATION_TEST_SUITE.md` section 6 requires "at least 100,000
sampled bodies" with total single-substitution detection for Light, Medium
and Heavy. Section 19 lists "single-substitution checksum performance is
measured" as a freeze gate.

- JS: sampled only (`js/test/codec.test.ts:171`).
- Python: 50 ids/generation on the expandable tier
  (`python/tests/test_expandable.py:228-262`).
- Ruby: 50 ids/generation (`ruby/test/test_expandable.rb:198-229`).
- Rust: none, only id-hunting loops (`rust/tests/codec.rs:612`).
- Go: none, only a 100k round-trip and a filter hunt (`go/codec_test.go:509`).

Fix: add the sweep to each port and run it in CI, or formally retract the
gate from the spec.

### 12. Most of the test-suite spec is aspirational

| Layer | JS | Python | Ruby | Rust | Go |
|---|---|---|---|---|---|
| Property tests (framework) | yes (fast-check) | no | no | no | no |
| Fuzz (real target) | yes (fast-check 1000) | yes (4000 iters) | yes (3 seeded) | partial (smoke) | no `func Fuzz` |
| Benchmarks | no | no | no | no | no `Benchmark` |
| Security tests | no | partial | no | partial | no |
| 24 CPU-hr fuzz (release gate 19) | no | no | no | no | no |

Spec section 19 release gates ("fuzzing for at least 24 cumulative CPU
hours", "security review is complete", "single-substitution checksum
performance is measured") are not enforced in `.github/workflows/ci.yml` or
`release.yml`. Go notably lacks a `func Fuzz` target despite shipping
native fuzzing.

Fix: add a `func Fuzz` target to Go, add `proptest`/`hypothesis`-style
property tests to Python, Ruby and Rust, and add at least one benchmark
per port to guard the spec's p99 targets. Decide explicitly which gates are
real and remove the rest from the spec.

### 13. Cross-language agreement rests on matching 299 frozen vectors

`ci.yml` runs five independent jobs. `release.yml` runs all five in a
`verify` job and gates publishing on it, which satisfies spec section 13
("a release fails if any supported implementation disagrees") transitively:
each must match the same frozen vectors. But there is no step that runs all
five and diffs their outputs. Conformance is only as strong as vector
coverage (299 vectors, 76 Feistel, 20 errors, 2 correction, 7 encodeErrors)
plus the property/fuzz backstop, which item 12 shows is thin. Two ports
could agree on all 299 vectors but disagree on an untested id, and nothing
would catch it.

Fix: add a single conformance job that encodes and decodes a dense id
sample across all five ports and asserts identical outputs, independent of
the shared vector file.

## P2 - hygiene and OSS credibility

### 14. No linters anywhere; CI runs `go vet` and nothing else

No `golangci-lint`/`staticcheck`, no `rubocop`/`standardrb`, no
`clippy`/`rustfmt`, no `ruff`/`mypy`. For a five-language OSS project this
reads as "no quality gate." `go vet` alone misses real bugs that
`staticcheck` catches.

Fix: add a lint config per language and gate it in CI. Add `#![forbid(unsafe)]`
to the Rust crate (no unsafe exists today; the attribute prevents future
additions) and a `rust-version`/MSRV to `Cargo.toml` (the code uses
`is_multiple_of`, stabilized in 1.87).

### 15. Incomplete package metadata

- Ruby `ruby/baseh.gemspec:20-22`: `spec.metadata` has only
  `rubygems_mfa_required`. Missing `homepage`, `source_code_uri`,
  `changelog_uri`, `bug_tracker_uri`, `spec.email`. RubyGems warns on
  publish without these.
- Rust `rust/Cargo.toml`: missing `repository`, `homepage`,
  `documentation`, `keywords`, `categories`, `readme`.
- Python `python/pyproject.toml`: missing classifiers and `[project.urls]`;
  tests use `sys.path.insert(0, ...)` hacks instead of an editable install.
- No `.ruby-version` or pinned contributor toolchain versions.

### 16. EOL or old runtimes

- `python/pyproject.toml`: `requires-python >= 3.9` (EOL October 2025).
- `go/go.mod`: `go 1.22` (roughly 2.5 years old as of August 2026).
- Rust: no MSRV declared, but uses APIs stabilized in 1.87.

Fix: raise `requires-python` to a supported version (3.11 or 3.12) and
declare an MSRV. Bump the Go minimum only if a newer stdlib is needed.

### 17. Minor code smells

- Go `go/codec.go:14`, `go/blocklist.go:27`, `go/profiles.go:111`: exported
  mutable globals (`ConfusionMaps`, `DefaultBlocklist`, `FrozenKeyBytes`).
  Any caller can mutate the shared maps/slices at runtime; concurrent read
  plus write is a data race. This contradicts the library's "concurrent
  safe" claim. Unexport them, return deep copies via functions or document
  "do not mutate."
- Go `go/codec.go:202-204`: `MaxCorrections` is dead code (see item 7).
- Go `go/zero.go:62-67`: `FromCode` strips all Unicode whitespace via
  `unicode.IsSpace`, exceeding the spec's ASCII-only scope.
- Rust `rust/src/basen.rs:15-19`: `encode_base_n` uses `unwrap_or(0)`,
  which would silently produce digit 0 on an impossible conversion failure
  rather than failing. Use `expect`.
- Rust `rust/src/codec.rs:288-294` and `rust/src/profile.rs:134-140`:
  `pow_bigint` is duplicated across two modules. Share one utility.
- Rust `rust/src/codec.rs:563`: `expect("exactly one valid candidate")` in
  a user-facing decode path. Logically unreachable, but restructure to
  avoid the panic.
- JavaScript `js/src/codec.ts:169-173` and `js/src/profile.ts:79-83`:
  `powBigInt` is duplicated across two modules.
- JavaScript `js/src/checksum.ts:34-38`: `calculateChecksum` rebuilds the
  body-index `Map` on every call (up to 64 times during correction) instead
  of reusing the `Baseh.bodyIndex` already held on the instance. Pass the
  index in or cache it.
- Ruby `ruby/lib/baseh/basen.rb:9-18`: `encode_base_n` does not validate
  `value < capacity` and silently truncates. The function is a public
  `module_function`, so a direct caller gets silent corruption.
- Ruby `ruby/lib/baseh/profiles.rb:126-129`: a comment claims the
  expandable body alphabet "lists only 32 symbols (it also drops I and L)."
  It actually has 34 symbols and includes I and L (it drops only 0 and O,
  per the zero ban). The code is correct; the comment would mislead a
  maintainer into "fixing" the alphabet and breaking every capacity.
- Ruby `ruby/lib/baseh/zero.rb:21`: `ZERO = Baseh.new(...)` eager-initializes
  at file load, so a frozen-profile validation failure would stop the gem
  from loading. Lazy initialization is safer.
- Ruby `ruby/lib/baseh/feistel.rb:13`: internal Feistel helpers (`walk`,
  `run_rounds`, `round_message`, etc.) are public `module_function`. Only
  `permute` and `inverse_permute` need to be public.
- Python `python/src/baseh/profile.py:51`: `PreparedProfile` is a frozen
  dataclass but `aliases_norm` is a plain `dict` (mutable in place). Other
  collections are tuples. Use `types.MappingProxyType`.
- Python `python/src/baseh/profile.py:215-216`: a non-list `grouping`
  reports "grouping must be empty when separator is empty" regardless of
  the actual separator. The profile is correctly rejected; the message
  misleads debugging.

### 18. Divergent input-validation strictness

- Blocklist word regex: JS `js/src/blocklist.ts:20` uses
  `^[A-Za-z]{2,32}$`, which accepts a trailing newline; Ruby
  `ruby/lib/baseh/profanity.rb:14` uses `\A[A-Za-z]{2,32}\z`, which does
  not. Ruby is stricter and correct; JS is slightly lenient.
- `from_code` whitespace stripping strips Unicode whitespace in Go
  (`go/zero.go:62-67`) and Rust (`rust/src/zero.rs:105`), matching JS's
  `/\s+/g`, while the spec restricts the format to ASCII. Harmless in
  practice (spaces are not symbols) but a documented divergence.

### 19. Web package has an undeclared dependency

`web/package.json` lists only `@noble/hashes`, but `web/src/core.ts:5`,
`web/src/designer.ts:3` and `web/src/calculator.ts:3` all import from
`@cloudyventures/baseh`. Resolution works only via a Vite alias
(`web/vite.config.ts:8` -> `../js/src/index.ts`) and tsconfig path mapping.
`npm ci` in `web/` installs nothing for baseh. Reorganizing `js/src`
silently breaks the web build with no signal in web's own dependency
manifest.

Fix: add `@cloudyventures/baseh` as a `file:` dependency in
`web/package.json`, or document the alias as the intended coupling.

## Strategic call, not a bug

### 20. License

AGPL-3.0-plus-commercial (`LICENSE`, `COMMERCIAL.md`) is a defensible
dual-license model, but AGPL is the single license most enterprise
consumers blanket-ban. For a small new library hoping for adoption it is
the loudest possible "won't touch this" signal. This is a business decision,
not a code defect, but it should be made with eyes open, and the commercial
path needs to be obviously findable before people bounce.

### 21. Registry names

The names `baseh` (PyPI, crates.io, RubyGems) and `@cloudyventures/baseh`
(npm) are generic single-word names and squatter bait. Confirm each is
claimed and available before first release. The Go module path
`github.com/cloudyventures/baseh/go/v2` is the correct v2 major-suffix form
for a `go/` subdirectory and is importable once that repo is public.

## What was verified correct

- Frozen profile definitions (alphabets, aliases, key bytes, grouping,
  `maxRepetition`, `separatorMinLength`, `minLength`) match byte-for-byte
  across all five ports and the shared `vectors.json`.
- Expandable capacity is `34^(L-2)` in all five; generation boundaries
  L=4..8 match the shared `generations` table and spec 17.1.
- The Feistel round message, half-width alternation, low-bits extraction and
  cycle walking are byte-identical in effect across all five (JS
  `@noble/hashes`, Python stdlib, Rust `hmac`+`sha2`, Go stdlib, Ruby
  OpenSSL) and confirmed by the 76 shared `feistel-vectors.json`. Ruby's
  OpenSSL dependency is the only non-stdlib crypto in the set, worth a note
  in the Ruby README.
- The checksum rolling polynomial (state=17, mult=37, domain =
  ASCII(profileId)+0x00, per-symbol `state*37 + symbolValue + pos+1` mod
  `S^K`) matches spec 6.2 exactly in every port.
- Normalization order, the expandable zero ban, the derived checksum
  alphabet (`"0" + body`), no-left-pad, balanced grouping and the separator
  threshold all match spec 19.
- The repetition filter (run `>= maxRepetition` on the raw code, separators
  ignored, `BLOCKED_CODE` on encode and on decode/correction consistency)
  matches spec 21 in every port.
- All five consume the same shared `vectors/` (no vendored copies) and all
  test suites pass on their current build.
- No leftover `basehuman` references after the `baseh` rename.

## Recommended fix order

1. Untrack `js/node_modules` and `js/dist` (item 1).
2. Gate the Pages deploy on tests and `tsc`; escape the calculator
   `innerHTML`; add CSP (items 2, 3).
3. Cap `generationForId` and remove the public-API panics in Rust; fix the
   Python `validate()` leak and the int-to-str error path (items 4, 5, 9).
4. Add a real cross-language conformance job and the 100k checksum sweep to
   CI; add `func Fuzz` to Go and property tests to the other ports (items
   11, 12, 13).
5. Standardize separator handling and the `minLength`/`maxCorrections`
   option semantics across ports; add a shared multi-char-separator vector
   (items 6, 7).
6. Reconcile the README, the test-suite spec and the Feistel-tag byte count
   with the shipped code; fix the Python version mismatch (item 8).
7. Add lint configs and complete package metadata across all five (items
   14, 15); raise the Python minimum and declare an MSRV (item 16).
8. Sweep the minor code smells (item 17) and the web dependency declaration
   (item 19).
9. Make the license and registry-name decisions deliberately (items 20, 21).

Items 1, 2 and 3 are hours of work and remove the most embarrassing
exposure. Item 4 is the one that protects the core cross-language promise
long-term. The design itself does not need rethinking.