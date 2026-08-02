#!/usr/bin/env bash
# Release preflight: every published manifest and generated lockfile must
# agree on one version. Catches the failure class that broke the v2.0.1
# rubygems publish (Gemfile.lock pinned the previous baseh version while
# bundler ran frozen in CI). Run before tagging a release; ci.yml runs it
# on every push so a mismatch can never reach a tag.
set -eu
cd "$(dirname "$0")/.."

want() {
  desc="$1"; got="$2"; ref="$3"
  if [ "$got" != "$ref" ]; then
    echo "MISMATCH: $desc is $got, expected $ref" >&2
    exit 1
  fi
}

js=$(grep -m1 '"version"' js/package.json | sed 's/[^0-9.]//g')
py=$(grep -m1 '^version' python/pyproject.toml | sed 's/[^0-9.]//g')
rs=$(grep -m1 '^version' rust/Cargo.toml | sed 's/[^0-9.]//g')
rb=$(grep -m1 'VERSION' ruby/lib/baseh/version.rb | sed 's/[^0-9.]//g')
web=$(grep -m1 '"version"' web/package.json | sed 's/[^0-9.]//g')

want "js/package.json" "$js" "$rs"
want "python/pyproject.toml" "$py" "$rs"
want "ruby version.rb" "$rb" "$rs"
want "web/package.json" "$web" "$rs"

# Generated lockfiles must carry the same version for the baseh package
# itself. The rubygems v2.0.1 failure was exactly this check failing.
cargo_lock=$(awk '/^name = "baseh"/{getline; print}' rust/Cargo.lock | sed 's/[^0-9.]//g')
gem_lock=$(grep -m1 '    baseh (' ruby/Gemfile.lock | sed 's/[^0-9.]//g')
js_lock=$(grep -m1 '"version"' js/package-lock.json | sed 's/[^0-9.]//g')
web_lock=$(grep -m1 '"version"' web/package-lock.json | sed 's/[^0-9.]//g')

want "rust/Cargo.lock" "$cargo_lock" "$rs"
want "ruby/Gemfile.lock" "$gem_lock" "$rs"
want "js/package-lock.json" "$js_lock" "$rs"
want "web/package-lock.json" "$web_lock" "$rs"

echo "version preflight ok: $rs across all manifests and lockfiles"
