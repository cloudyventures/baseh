# base-human

Human Reference Codes (HRC): reversible, checksummed, human-safe short
references for non-negative integers. For order numbers, support tickets,
returns, bookings and similar records that people read, type and dictate.

```text
7KM-4Q2-H
```

- **Reversible**: an internal integer ID converts to a code and back, exactly.
- **Checksummed**: routine transcription typos are detected on decode.
- **Human-safe alphabet**: no `O`/`0`, `I`/`1`/`L` confusion in canonical output.
- **Aliases**: typed `O`, `I`, `L` are accepted as `0`, `1`, `1`.
- **Optional permutation**: a keyed Feistel shuffle hides sequence and volume.
  It is presentation only; it is not encryption and not access control.
- **Correction with abstention**: checksum-guided substitution suggestions
  that return `AMBIGUOUS_INPUT` instead of guessing.

## Install

| Language | Command |
|---|---|
| JavaScript / TypeScript | `npm install base-human` |
| Python | `pip install base-human` |
| Go | `go get github.com/matellis/base-human/go` |
| Rust | `cargo add base-human` |
| Ruby | `gem install base-human` |

## Quick start

```typescript
import { Hrc, hrc32V1 } from "base-human";

const hrc = new Hrc(hrc32V1({ keyBytes: myKey, keyId: "prod-01" }));

const code = hrc.encode(123456789n);   // e.g. "7KM-4Q2-H"
const { id } = hrc.decode("7km 4q2 h", { acceptSpaces: true });
console.log(id === 123456789n);        // true
```

Every implementation shares one behaviour contract: the vectors in
[`vectors/`](vectors) are the cross-language conformance suite, and a release
fails if any implementation disagrees with them.

## Profiles

Two frozen profiles ship with the library. Keys are supplied by your
application and never shipped in profiles or exports.

- **`hrc32-v1`** (6 body + 1 check, `3-3-1` grouping): ~1.07 billion references.
  For assisted support where a human agent can ask for the code again. The
  checksum detects ~99% of errors; a structured gap exists for symbol pairs
  26 values apart (see spec 6.3).
- **`hrc32s-v1`** (6 body + 2 check, `3-3-2` grouping): same capacity,
  provably detects all single-symbol substitutions and all adjacent
  transpositions. For unattended self-service lookup.

## Tools

Interactive, client-side only:

- [Capacity calculator](https://matellis.github.io/base-human/) - parameters
  in, exact capacity and operational lifetime out.
- [Code designer](https://matellis.github.io/base-human/designer.html) -
  required capacity in, shortest valid configuration out.

Previews with permutation use a published demo key. Never use demo key
material in an application.

## Repository layout

```text
spec/       normative design documents
vectors/    frozen cross-language conformance vectors
js/         TypeScript reference implementation (npm: base-human)
python/     Python implementation (PyPI: base-human)
go/         Go implementation (module github.com/matellis/base-human/go)
rust/       Rust implementation (crates.io: base-human)
ruby/       Ruby implementation (RubyGems: base-human)
web/        calculator and designer source
docs/       application cookbook (lookup endpoint, observability)
```

## Security

An HRC is a reference alias, never an authorization token. Enforce
authorization after decode, rate-limit public lookups and do not treat the
permutation as secrecy. See [`spec/README.md`](spec/README.md) and
[`docs/cookbook.md`](docs/cookbook.md).

## Status and release process

The codec, both frozen profiles and the vector suite are version 1. Releases
are cut with a git tag (`vX.Y.Z`); CI verifies all five implementations
against the frozen vectors, then publishes to npm, PyPI, crates.io and
RubyGems and tags `go/vX.Y.Z` for the Go module. Publishing uses OIDC
trusted publishing with no stored tokens; setup is in
[`docs/releasing.md`](docs/releasing.md).

## License

AGPL-3.0 (see [`LICENSE`](LICENSE)). Free for any project whose own source
is also released under the AGPL. Proprietary use, for example a closed SaaS
product, requires a commercial license: see [`COMMERCIAL.md`](COMMERCIAL.md).
