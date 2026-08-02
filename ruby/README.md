# baseh

Ruby port of the baseH (Human Reference Code) codec. Encodes integer IDs as
short, checksummed, human-friendly reference codes with a feistel-v1
permutation on every tier and profanity safety. The normative spec is
`spec/IMPLEMENTATION_CODEC.md` in the monorepo root.

## Install

```sh
gem install baseh
```

or in a Gemfile:

```ruby
# Gemfile
gem "baseh", path: "ruby"
```

or from a local build:

```sh
gem build baseh.gemspec
gem install ./baseh-2.0.0.gem
```

Zero runtime dependencies. Only `openssl` and `json` from the standard
library are used.

## Expandable mode (recommended default)

Profiles carry a `mode:` field: `"expandable"` or `"fixed"`. Expandable is
the recommended default for new users. The frozen tier
`Baseh.baseh_expandable_v1` ships as the starting point, with a keyed
private-mapping variant `Baseh.baseh_expandable_p_v1` that relates to it
exactly as the other `-p` tiers relate to their plain tiers.

```ruby
require "baseh"

codec = Baseh::Baseh.new(Baseh.baseh_expandable_v1)

code = codec.encode(id: 123_456)   # 4 characters at this namespace size
codec.decode(code).id              # => 123456
```

How expandable differs from fixed:

- **Codes start short and grow.** Minimum length is 4 characters
  (`min_length`, default 4). When the id sequence climbs past a length's
  capacity, codes simply become one character longer — transparently, no
  migration, no re-issue. Old shorter codes keep decoding forever.
- **Medium safety plus the zero ban.** The default expandable body alphabet
  is the 27 symbols left after the medium visual and spoken safety strips
  and the `0`/`O` zero ban, so an issued code never emits a visual or spoken
  confusable. A custom alphabet containing `0`/`O` has those symbols silently
  removed during profile preparation (the derived alphabet is always
  displayed in tooling). This applies on top of whatever visual/spoken
  safety levels, profanity modes, or blocklists are configured; every
  existing profile option composes with expandable unchanged.
- **Checksum alphabet gains `0`.** The checksum alphabet is the body
  alphabet plus `0` (28 symbols for the default). The existing input alias
  `O -> 0` remains, so a typed or misread `O` in a checksum position
  resolves to `0`. There is no left-padding in expandable mode; a `0` or
  `O` in a body position of presented input is simply an invalid character.
- **Permutation stays on.** The Feistel permutation is applied per
  generation (per code length), with the length mixed into the key
  derivation alongside the profile id. Codes within each length look random
  even though issuance is a sequential counter. Presentation only, not
  encryption.
- **Separators appear later.** Grouping only kicks in once codes reach
  `separator_min_length` (the shipped tier uses 6, so no hyphen until codes
  are 6+ characters). Below the threshold there is no separator.
- **Decode is length-driven.** The code's length selects the generation;
  the checksum validates exactly as in fixed mode, domain-separated by
  profile id.

The security posture is unchanged: a code is a reference alias, never an
authorization token. Expandable codes in the smallest generations are a
small namespace, so rate-limit public lookups and enforce authorization
after decode.

## Fixed mode (frozen tiers)

Four frozen tiers ship with the gem, all `mode: "fixed"`, built from the
full alphanumeric set with cumulative visual and spoken strips. All four encode 6 body symbols,
are case-insensitive, hyphen-delimit at the midpoint, run the default
profanity blocklist and permute with the published frozen key.

| Tier | Helper | Body symbols | Checksum | Format | Capacity |
| ---- | ------ | ------------ | -------- | ------ | -------- |
| Minimum | `Baseh.baseh_minimum_v1` | 36 | none | `XXX-XXX` | 2,176,782,336 |
| Light | `Baseh.baseh_light_v1` | 31 | 2 | `XXXX-XXXX` | 887,503,681 |
| Medium | `Baseh.baseh_medium_v1` | 28 | 2 | `XXXX-XXXX` | 481,890,304 |
| Heavy | `Baseh.baseh_heavy_v1` | 26 | 2 | `XXXX-XXXX` | 308,915,776 |

Medium is the default of the fixed tiers. The frozen key is public by
design: it hides sequence, not records. It is not a secret and anyone can read it at
`Baseh::FROZEN_KEY_BYTES`; it must never change for a live namespace. Each
tier keeps the typed O/I/L aliases where possible and adds spoken-confusion
aliases for the stripped symbols.

Every helper returns a freshly built mutable profile hash on each call, so
callers can load a default and modify it before constructing a codec.

## Usage

```ruby
require "baseh"

codec = Baseh::Baseh.new(Baseh.baseh_expandable_v1)

code = codec.encode(id: 123_456)           # => short code, grows as ids climb

result = codec.decode(code)
result.id                                  # => 123456
result.canonical_code                      # => canonical form
result.corrected                           # => true when input needed correction

check = codec.validate("00000000")
check.valid                                # => false
check.reason                               # => "INVALID_CHECKSUM"

# Live as-you-type feedback for a code entry field (never raises)
look = codec.inspect("C8XP8")
look.state                                 # => "typing" (or "empty", "bad-char",
                                           #     "too-long", "invalid", "valid")
look.typed                                 # => "C8XP-8"
look.progress                              # => 0.625

# Spoken-confusion correction
result = codec.decode("TB14QDFU", try_correction: true, confusion_profile: :light)
```

The same API applies to the fixed tiers (`codec.capacity` reports the fixed
namespace size there; expandable grows instead):

```ruby
codec = Baseh::Baseh.new(Baseh.baseh_medium_v1)
codec.capacity                             # => 481890304
```

## Permutation

The plain tiers permute with `Baseh::FROZEN_KEY_BYTES`, the published frozen
key. The `-p` variants take caller-supplied key material instead; keep that
key in a secret manager and never change it for a live profile:

```ruby
profile = Baseh.baseh_medium_p_v1(
  key_bytes: File.binread("path/to/key.bin"),
  key_id: "prod-01"                        # optional, defaults to "default"
)
codec = Baseh::Baseh.new(profile)
```

`rounds:` is also accepted (default 8). The `-p` profile is identical to
its plain tier apart from the key material; its profile id gains a `-p`
segment, for example `baseh-medium-p-v1`.

## Profanity safety (spec 18)

Profiles accept an optional `profanity:` object:

```ruby
# mode "no-vowels": vowels are stripped from both alphabets at construction
# and can never appear in issued codes.
profanity: { mode: "no-vowels" }

# mode "blocklist": encode raises BLOCKED_CODE when the raw code contains an
# entry. words replaces the default list, extra_words appends to it.
profanity: { mode: "blocklist", words: ["ZZZZ"], extra_words: ["QQQQ"] }
```

The frozen tiers run the default blocklist out of the box.

All failures raise `Baseh::BasehError` with a `#code` from the spec:
`INVALID_PROFILE`, `OUT_OF_RANGE`, `PERMUTATION_FAILURE`, `INVALID_LENGTH`,
`INVALID_CHARACTER`, `INVALID_CHECKSUM`, `AMBIGUOUS_INPUT`,
`TOO_MANY_CANDIDATES` and `BLOCKED_CODE`. `validate` never raises on user
input.

Ruby `Integer` is arbitrary precision, so every capacity and ID operation is
exact at any size.

## Tests

```sh
rake            # or: ruby -Ilib -Itest -e 'Dir["test/test_*.rb"].each { |f| require "./#{f}" }'
SLOW=1 rake     # includes the 10k sequential round trip and bijection checks
```

The vector tests load `../vectors/vectors.json` and
`../vectors/feistel-vectors.json` from the monorepo root and assert every
entry. Running the suite from a different directory layout requires those
files at that relative path.

The full 100,000-body single-substitution checksum sweep of the test-suite
spec (section 6) runs under `BASEH_SOAK=1` alongside the soak suite:

```sh
BASEH_SOAK=1 rake test          # full soak + 100k checksum sweep per tier
BASEH_SOAK=1 BASEH_SOAK_BODIES=1_000 rake test   # smoke the sweep
```

## Linting

No RuboCop config ships in this gem: RuboCop is not part of the bundle, and
adding a lint dependency was judged not worth it for a zero-dependency,
~500-line library whose conformance is enforced by the shared cross-language
vectors. The codebase follows the standard Ruby style (two-space indent,
frozen string literals) by convention instead.
