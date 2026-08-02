# Releasing

## How it works

1. Push a version tag, for example `git tag v1.0.0 && git push origin v1.0.0`.
2. The `release` workflow runs every test suite of all five implementations
   against the frozen vectors, then the release gates: the full
   100,000-sampled-body checksum sweep under `BASEH_SOAK=1` for Python, Go,
   Rust and Ruby (`cd python && BASEH_SOAK=1 python tests/test_checksum_sweep.py TestChecksumSweepFull`,
   `cd go && BASEH_SOAK=1 go test -run TestChecksumSweepFull -v .`,
   `cd rust && BASEH_SOAK=1 cargo test --release --test checksum_sweep -- --ignored single_substitution_sweep_full --nocapture`,
   `cd ruby && BASEH_SOAK=1 ruby -Ilib -Itest test/test_checksum_sweep.rb -n test_single_substitution_sweep_soak`)
   plus a five-minute Go fuzz run (`cd go && go test -fuzz=FuzzDecode -fuzztime=5m .`).
   Any disagreement stops the release.
3. On green, it publishes to npm, PyPI, crates.io and RubyGems and creates
   the `go/vX.Y.Z` tag for the Go module.
4. Once every publish and the Go tag succeed, it creates a GitHub Release
   on the tag with auto-generated release notes.

Publishing uses **OIDC trusted publishing**. There are no registry API
tokens, no GitHub secrets and nothing to rotate. GitHub vouches for the
workflow's identity and each registry checks it against the publisher
registration below.

## One-time setup per registry

Register the trusted publisher once in each dashboard. In every case the
repository is `cloudyventures/baseh` and the workflow is `release.yml`
(environment is left blank; publishing is keyed to tag pushes).

- **PyPI**: pypi.org, Manage account, Publishing, add a pending publisher
  for package name `baseh`. The pending form works before the package
  exists; the first release creates it.
- **npm**: npmjs.com, package `@cloudyventures/baseh` settings, Trusted Publisher,
  connect GitHub repo `cloudyventures/baseh` with workflow `release.yml`.
  For the very first publish of a new package name, create the package
  placeholder from the npm site first, then connect the publisher.
- **crates.io**: crates.io, crate `baseh` settings, Trusted Publishing,
  add GitHub Actions owner `cloudyventures`, repo `baseh`, workflow
  `release.yml`. The first publish of a brand-new crate name uses the same
  flow once the name is registered in the dashboard.
- **RubyGems**: rubygems.org, gem `baseh` (create the gem entry or
  claim it on first push per rubygems.org trusted-publishing docs), Trusted
  Publishers, add repo `cloudyventures/baseh`, workflow `release.yml`.

If a registry's first-publish flow still demands a classic token, mint a
scoped publish token for that registry only, record it in 1Password first,
then add it as the GitHub secret that registry's step expects. Treat this as
a fallback, not the default.

## Rules

- Never commit a registry token to this repository.
- Never add a secret to GitHub that is not already recorded in 1Password.
- If the verify job fails, fix the implementations and re-tag; do not bypass.
- The Go module has no registry step at all; `go/vX.Y.Z` tags are created by
  the workflow and require no setup.
- Before tagging, confirm `scripts/check-versions.sh` is green (ci runs it
  as the release-preflight job on every push). It exists because the v2.0.1
  rubygems publish failed on a stale Gemfile.lock pin. After any version
  bump, re-bundle (`cd ruby && bundle install`) and refresh the JS locks
  (`npm install --package-lock-only` in js/ and web/); `cargo check`
  refreshes rust/Cargo.lock.

## Lessons from the first releases (v2.0.0 to v2.0.2)

The release workflow had never executed until v2.0.0, so its tag-only bugs
surfaced one per release:

- v2.0.0: publish-crates wrote its log inside rust/, so cargo publish
  refused a dirty tree. The go tag push was rejected because the Actions
  token cannot push a ref whose tree touches .github/workflows (fix:
  tolerate that rejection and push the go tag manually with SSH).
- v2.0.1: publish-rubygems failed because Gemfile.lock still pinned the
  previous baseh version and bundler runs frozen in CI (fix:
  scripts/check-versions.sh as a CI gate).

The publish jobs run in parallel and independently, so one registry's
failure never blocks the others. Only the GitHub Release job requires all
of them, which is deliberate: a skipped GitHub Release is the signal that a
release is partial. Recover by fixing the cause, bumping the patch version
everywhere and tagging again; already-published registries treat the repeat
version as success (skip-existing or the equivalent guard in each step).

Offline rehearsal is only partial: `cargo publish --dry-run`,
`npm publish --dry-run` and `gem build` catch packaging errors, but the
failures above were environmental (lockfile freshness, token scope, a dirty
tree inside the crate) and only appear in the CI sandbox. The preflight
check plus the publish jobs' already-published tolerance are the safety
net; a failed release is always recoverable by tagging the next patch.
