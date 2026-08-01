# Releasing

## How it works

1. Push a version tag, for example `git tag v1.0.0 && git push origin v1.0.0`.
2. The `release` workflow runs every test suite of all five implementations
   against the frozen vectors. Any disagreement stops the release.
3. On green, it publishes to npm, PyPI, crates.io and RubyGems and creates
   the `go/vX.Y.Z` tag for the Go module.

Publishing uses **OIDC trusted publishing**. There are no registry API
tokens, no GitHub secrets and nothing to rotate. GitHub vouches for the
workflow's identity and each registry checks it against the publisher
registration below.

## One-time setup per registry

Register the trusted publisher once in each dashboard. In every case the
repository is `matellis/baseh` and the workflow is `release.yml`
(environment is left blank; publishing is keyed to tag pushes).

- **PyPI**: pypi.org, Manage account, Publishing, add a pending publisher
  for package name `base-human`. The pending form works before the package
  exists; the first release creates it.
- **npm**: npmjs.com, package `base-human` settings, Trusted Publisher,
  connect GitHub repo `matellis/baseh` with workflow `release.yml`.
  For the very first publish of a new package name, create the package
  placeholder from the npm site first, then connect the publisher.
- **crates.io**: crates.io, crate `base-human` settings, Trusted Publishing,
  add GitHub Actions owner `matellis`, repo `base-human`, workflow
  `release.yml`. The first publish of a brand-new crate name uses the same
  flow once the name is registered in the dashboard.
- **RubyGems**: rubygems.org, gem `base-human` (create the gem entry or
  claim it on first push per rubygems.org trusted-publishing docs), Trusted
  Publishers, add repo `matellis/baseh`, workflow `release.yml`.

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
