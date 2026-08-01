# baseH

Communicating identifiers with humans has been a challenge: you either end up with a long string of numbers or a mix of letters and numbers like an airline reservation. You're forced to choose between the benefits of hard to confuse, easy to say over the phone but easily to mis-transcribe and too long against the opposite. 

baseH is designed to give you the best of both worlds: short, clear codes that are easily to copy and to say. It's base36 reworked for humans: a reversible, checksummed encoding of non-negative integers into short references that people can read, type and dictate over the phone. The alphabet drops the symbols that cause transcription errors and a checksum catches the rest. It's intended to be used for order numbers, support tickets, returns, bookings and similar records.

This implementation gives you total control over length, capacity, checksums and profanity, with error hardening for audio, visual or both. It was originally developed in support of new AI based customer service systems where a user might start in one channel and follow up in another, e.g. start on chat, follow up by phone, and so needed an easy to use reference number that worked both over the phone and the keyboard. 

- **Reversible**: an internal integer ID converts to a code and back, exactly.
- **Expandable by default**: codes start at four characters and grow one
  symbol at a time as the id sequence fills each length. No migrations, no
  re-issue; shorter codes decode forever. Fixed-width profiles remain for
  constant-width needs.
- **Checksummed**: routine transcription typos are detected on decode.
- **Human-safe alphabet**: no `O`/`0`, `I`/`1`/`L` confusion in canonical output.
- **Aliases**: typed `O`, `I`, `L` are accepted as `0`, `1`, `1`.
- **Permutation always on**: every frozen tier shuffles sequence with a
  published frozen key (per code length in expandable mode), so codes never
  read as adjacent. For a private mapping the keyed `-p` tiers take your own
  key. Either way it is presentation only; it is not encryption and not
  access control.
- **Correction with abstention**: checksum-guided substitution suggestions
  that return `AMBIGUOUS_INPUT` instead of guessing.

## Demo & Tools

Interactive, client-side only:

- [Capacity calculator](https://cloudyventures.github.io/baseh/) - parameters
  in, exact capacity and operational lifetime out.
- [Code designer](https://cloudyventures.github.io/baseh/designer.html) -
  required capacity in, shortest valid configuration out.

## Install

| Language | Command | Examples |
|---|---|---|
| JavaScript / TypeScript | `npm install @cloudyventures/baseh` | [js/examples/examples.ts](js/examples/examples.ts) |
| Python | `pip install baseh` | [python/examples/examples.py](python/examples/examples.py) |
| Go | `go get github.com/cloudyventures/baseh/go/v2` | [go/examples/main.go](go/examples/main.go) |
| Rust | `cargo add baseh` | [rust/examples/examples.rs](rust/examples/examples.rs) |
| Ruby | `gem install baseh` | [ruby/examples/examples.rb](ruby/examples/examples.rb) |

## Quick start

```typescript
import { Baseh, basehExpandableV1 } from "@cloudyventures/baseh";

const h = new Baseh(basehExpandableV1());

const code = h.encode(12345n);   // 4 characters at this namespace size; grows as ids climb
const { id } = h.decode(code);
console.log(id === 12345n);        // true
```

Codes from the expandable tier are short while the namespace is small and
gain a symbol automatically as it fills. If you need a constant width
instead, the fixed tiers behave exactly as before:

```typescript
const h = new Baseh(basehMediumV1());
const code = h.encode(123456789n);   // "C8XP-8J49"
```

Every frozen tier hides sequence with the public frozen key (per code length
in expandable mode). For a private mapping, use a keyed `-p` tier and supply
your own key:

```typescript
const h = new Baseh(basehExpandablePV1({ keyBytes: myKey, keyId: "prod-01" }));
```

Every implementation shares one behaviour contract: the vectors in
[`vectors/`](vectors) are the cross-language conformance suite, and a release
fails if any implementation disagrees with them.

## Profiles

Profiles carry a `mode`: `"expandable"` (the default for new profiles) or
`"fixed"`. Every existing option — visual and spoken safety levels, custom
alphabets, profanity modes, blocklists, separators — composes with either
mode unchanged.

### Expandable mode (default)

The `baseh-expandable-v1` tier is the recommended starting point:

- **Starts short, grows on its own**: minimum four characters (the profile
  field `minLength`). When the id sequence outgrows a length, codes become
  one symbol longer — transparently, with no re-issue and no migration.
  Shorter codes decode forever.
- **No `0` or `O` in the body, ever**: the default body alphabet is the 34
  remaining alphanumerics, and a custom alphabet has `0`/`O` removed during
  profile preparation (tooling always displays the derived alphabet). No
  code can start with a zero glyph, so there is nothing to mis-drop and no
  left-padding anywhere.
- **Checksum keeps the zero**: the checksum alphabet is the body alphabet
  plus `0`, and the `O -> 0` input alias still applies, so a misread `O` in
  a checksum position resolves correctly.
- **Short checksum on by default**: the shortest, most-typed codes carry one
  checksum symbol instead of two — one through five characters, two beyond —
  so generation 4 holds 39,304 ids instead of 1,156 (spec section 22;
  configurable via `shortChecksumLength`/`shortChecksumUntil`,
  `shortChecksumUntil: 0` turns it off).
- **Permuted per length**: the Feistel permutation runs within each code
  length's range with the length mixed into the key derivation, so codes
  look random at every size even though issuance is sequential.
- **Separator on a threshold**: the shipped tier introduces the hyphen at
  six characters (the profile field `separatorMinLength`); shorter codes
  print bare. The split is a balanced function of the code length —
  `XXX-XXX` at six, `XXXX-XXX` at seven, `XXXX-XXXX` at eight — so there
  is no grouping to configure in expandable mode.
- **Repetition filter on**: like every frozen tier, the expandable tier
  ships `maxRepetition: 4`, so codes with a run of four or more identical
  symbols are never issued (configurable to any floor of 3 or more, or 0
  to turn it off).

A keyed variant `baseh-expandable-p-v1` takes your own key for a private
mapping, like the other `-p` tiers.

### Fixed mode (frozen tiers)

Four frozen tiers ship with the library, all `mode: "fixed"`, all running
the default profanity blocklist, all blocking runs of four or more identical
symbols (the repetition filter, `maxRepetition: 4` — configurable to any
floor of 3 or more, or 0 to turn it off), all six characters of body, all
hyphen-delimited and all permuting with the published frozen key:

| Tier | Symbols | Checksum | Shape | Capacity | Use for |
|---|---|---|---|---|---|
| `baseh-minimum-v1` | 36 | none | `XXX-XXX` | 2,176,782,336 | Typed contexts, maximum capacity |
| `baseh-light-v1` | 31 | 2 | `XXXX-XXXX` | 887,503,681 | Typed workflows with light safety |
| `baseh-medium-v1` | 28 | 2 | `XXXX-XXXX` | 481,890,304 | General use; **the default fixed tier** |
| `baseh-heavy-v1` | 26 | 2 | `XXXX-XXXX` | 308,915,776 | Spoken-first workflows |

The frozen key is public by design: it hides sequence, not records. Each
tier also has a keyed `-p` variant (`baseh-minimum-p-v1` through
`baseh-heavy-p-v1`) for a private mapping; those keys are supplied by your
application and never shipped in profiles or exports.

Profile helpers return a fresh profile object on every call, so you can load
a default and modify it (longer body, custom separator, blocklist off)
without touching the frozen definition:

```typescript
const profile = basehMediumV1();
profile.bodyLength = 7;
```

## When the namespace fills up

With an expandable profile, it fills up gracefully on its own: the code
simply gains a symbol and issuance continues. Nothing is re-issued, nothing
is migrated, and every shorter code keeps decoding. The guidance below
matters only for fixed-mode profiles, where capacity is a one-time design
decision.

Plan so it does not, and design so it does not matter if it does.

- **Size with headroom.** The designer defaults to a maximum utilization of
  50% and the calculator shows how many years a configuration lasts at your
  traffic. One extra body symbol multiplies capacity by the whole alphabet
  (about 28x at Medium), so an extra character of headroom usually costs less
  than a migration.
- **Old codes keep working when you do outgrow it.** Stretching the body
  creates a new versioned profile (`orders-v1` to `orders-v2`); codes issued
  under the old profile still decode against it forever. Keep both profiles
  registered in your lookup layer and route by length: codes are fixed width,
  so 8 characters means the old profile and 9 means the new one. The checksum
  mixes in the profile ID, so a code presented to the wrong profile fails
  validation loudly instead of silently resolving to the wrong record.
- **Customers never mark their codes.** Length alone distinguishes old from
  new, and the same id sequence simply continues under the longer profile.

## Repository layout

```text
spec/       normative design documents
vectors/    frozen cross-language conformance vectors
js/         TypeScript reference implementation (npm: @cloudyventures/baseh)
python/     Python implementation (PyPI: baseh)
go/         Go implementation (module github.com/cloudyventures/baseh/go/v2)
rust/       Rust implementation (crates.io: baseh)
ruby/       Ruby implementation (RubyGems: baseh)
web/        calculator and designer source
docs/       examples in all five languages, application cookbook
```

## Security

An baseH is a reference alias, never an authorization token. Enforce
authorization after decode, rate-limit public lookups and do not treat the
permutation as secrecy. See [`spec/README.md`](spec/README.md) and
[`docs/cookbook.md`](docs/cookbook.md).

Runnable zero-config, preset and customized examples in all five languages
live in [`docs/examples.md`](docs/examples.md) and the `examples/` directory
of each package.

## Status and release process

The codec, the four frozen tiers and the vector suite are version 2.
Expandable mode is implemented in all five languages and is the headline of
the next release; the `baseh-expandable-v1` helpers will not exist in
published packages until that release is cut. Releases are cut with a git tag (`vX.Y.Z`); CI verifies all five implementations
against the frozen vectors, then publishes to npm, PyPI, crates.io and
RubyGems and tags `go/vX.Y.Z` for the Go module. Publishing uses OIDC
trusted publishing with no stored tokens; setup is in
[`docs/releasing.md`](docs/releasing.md).

## License

AGPL-3.0 (see [`LICENSE`](LICENSE)). Free for any project whose own source
is also released under the AGPL. Proprietary use, for example a closed SaaS
product, requires a commercial license: see [`COMMERCIAL.md`](COMMERCIAL.md).
