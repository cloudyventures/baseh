## Dependency security policy

- Every Gemfile `source` line must carry `cooldown: 7` (bundler >= 4.0.13): `source "https://rubygems.org", cooldown: 7`. Keep `Gemfile.lock` `BUNDLED WITH` at 4.0.15 or newer (`bundle update --bundler` when stale).
- `.yarnrc.yml` must set `npmMinimalAgeGate: 7d` (yarn >= 4.10 required to enforce it).
- Dockerfiles must derive the bundler version from the lockfile (`gem install bundler:"$(grep -A 1 'BUNDLED WITH' Gemfile.lock | tail -1 | awk '{ print $1 }')"`), never a hardcoded `BUNDLER_VERSION`.
- CI enforces this via `.github/workflows/dependency-cooldowns.yml`, which fails the build on violations. Don't bypass it — fix the manifest.
- Verify: `bundle outdated` shows cooldown values; `yarn config get npmMinimalAgeGate` prints `10080`.
