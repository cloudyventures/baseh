# BaseH

Communicating identifiers with humans has been a challenge: you either end up with a long string of numbers or a mix of letters and numbers like an airline reservation. You’re forced to choose between the benefits of hard to confuse, easy to say over the phone but easily to mis-transcribe and too long against the opposite. 

BaseH is designed to give you the best of both worlds: short, clear codes that are easily to copy and to say. It’s base36 reworked for humans: a reversible, checksummed encoding of non-negative integers into short references that people can read, type and dictate over the phone. The alphabet drops the symbols that cause transcription errors and a checksum catches the rest. It’s intended to be used for order numbers, support tickets, returns, bookings and similar records.

This implementation gives you total control over length, capacity, checksums and profanity, with error hardening for audio, visual or both. It was originally developed in support of new AI based customer service systems where a user might start in one channel and follow up in another, e.g. start on chat, follow up by phone, and so needed an easy to use reference number that worked both over the phone and the keyboard. 

```text
7KM4Q2H
```

- **Reversible**: an internal integer ID converts to a code and back, exactly.
- **Checksummed**: routine transcription typos are detected on decode.
- **Human-safe alphabet**: no `O`/`0`, `I`/`1`/`L` confusion in canonical output.
- **Aliases**: typed `O`, `I`, `L` are accepted as `0`, `1`, `1`.
- **Optional permutation**: off by default; an application can opt into a
  keyed Feistel shuffle to hide sequence and volume. It is presentation only;
  it is not encryption and not access control.
- **Correction with abstention**: checksum-guided substitution suggestions
  that return `AMBIGUOUS_INPUT` instead of guessing.

## Install

| Language | Command |
|---|---|
| JavaScript / TypeScript | `npm install base-human` |
| Python | `pip install base-human` |
| Go | `go get github.com/matellis/baseh/go` |
| Rust | `cargo add base-human` |
| Ruby | `gem install base-human` |

## Quick start

```typescript
import { Baseh, baseh32V1 } from "base-human";

const h = new Baseh(baseh32V1());

const code = h.encode(123456789n);   // e.g. "7KM4Q2H"
const { id } = h.decode("7km 4q2 h", { acceptSpaces: true });
console.log(id === 123456789n);        // true
```

To hide visible sequence, opt into permutation with your own key:

```typescript
const h = new Baseh(baseh32V1({ keyBytes: myKey, keyId: "prod-01" }));
```

Every implementation shares one behaviour contract: the vectors in
[`vectors/`](vectors) are the cross-language conformance suite, and a release
fails if any implementation disagrees with them.

## Profiles

Two frozen profiles ship with the library, both with permutation off.
Sequence-hiding keys are opt-in: supplied by your application and never
shipped in profiles or exports.

- **`baseh32-v1`** (6 body + 1 check, no separators): ~1.07 billion references.
  For assisted support where a human agent can ask for the code again. The
  checksum detects ~99% of errors; a structured gap exists for symbol pairs
  26 values apart (see spec 6.3).
- **`baseh32s-v1`** (6 body + 2 check, no separators): same capacity,
  provably detects all single-symbol substitutions and all adjacent
  transpositions. For unattended self-service lookup.

## Tools

Interactive, client-side only:

- [Capacity calculator](https://matellis.github.io/baseh/) - parameters
  in, exact capacity and operational lifetime out.
- [Code designer](https://matellis.github.io/baseh/designer.html) -
  required capacity in, shortest valid configuration out.

## Repository layout

```text
spec/       normative design documents
vectors/    frozen cross-language conformance vectors
js/         TypeScript reference implementation (npm: base-human)
python/     Python implementation (PyPI: base-human)
go/         Go implementation (module github.com/matellis/baseh/go)
rust/       Rust implementation (crates.io: base-human)
ruby/       Ruby implementation (RubyGems: base-human)
web/        calculator and designer source
docs/       application cookbook (lookup endpoint, observability)
```

## Security

An BaseH is a reference alias, never an authorization token. Enforce
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
