# base-human

Ruby port of the BaseH (Human Reference Code) codec. Encodes integer IDs as
fixed-length, checksummed, human-friendly reference codes with an opt-in
reversible feistel-v1 permutation and profanity safety. The normative spec
is `spec/IMPLEMENTATION_CODEC.md` in the monorepo root.

## Install

```ruby
# Gemfile
gem "base-human", path: "ruby"
```

or

```sh
gem build base-human.gemspec
gem install ./base-human-1.0.0.gem
```

Zero runtime dependencies. Only `openssl` and `json` from the standard
library are used.

## Frozen tiers

Four frozen tiers ship with the gem, built from the full alphanumeric set
with cumulative visual and spoken strips. All four encode 6 body symbols,
are case-insensitive and run the default profanity blocklist.

| Tier | Helper | Body symbols | Checksum | Format | Capacity |
| ---- | ------ | ------------ | -------- | ------ | -------- |
| Minimum | `BaseHuman.baseh_minimum_v1` | 36 | none | `XXX-XXX` | 2,176,782,336 |
| Light | `BaseHuman.baseh_light_v1` | 31 | 1 | plain | 887,503,681 |
| Medium | `BaseHuman.baseh_medium_v1` | 28 | 1 | plain | 481,890,304 |
| Heavy | `BaseHuman.baseh_heavy_v1` | 26 | 1 | plain | 308,915,776 |

Medium is the default. Minimum keeps the full alphabet and uses a hyphen
delimiter; the rest have no separator. Each tier keeps the typed O/I/L
aliases where possible and adds spoken-confusion aliases for the stripped
symbols.

Every helper returns a freshly built mutable profile hash on each call, so
callers can load a default and modify it before constructing a codec.

## Usage

```ruby
require "base_human"

codec = BaseHuman::Baseh.new(BaseHuman.baseh_medium_v1)

code = codec.encode(id: 123_456)           # => raw fixed-width code

result = codec.decode(code)
result.id                                  # => 123456
result.canonical_code                      # => canonical form
result.corrected                           # => true when input needed correction

codec.capacity                             # => 481890304

check = codec.validate("0000000")
check.valid                                # => false
check.reason                               # => "INVALID_CHECKSUM"

# Spoken-confusion correction
result = codec.decode("TB14QDF", try_correction: true, confusion_profile: :light)
```

## Permutation (opt-in)

The `-p` variants opt a tier into the reversible feistel-v1 permutation.
`key_bytes:` is required; keep the key in a secret manager and never change
it for a live profile:

```ruby
profile = BaseHuman.baseh_medium_p_v1(
  key_bytes: File.binread("path/to/key.bin"),
  key_id: "prod-01"                        # optional, defaults to "default"
)
codec = BaseHuman::Baseh.new(profile)
```

`rounds:` is also accepted (default 8). The `-p` profile is identical to
its plain tier apart from the permutation; its profile id gains a `-p`
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

All failures raise `BaseHuman::BasehError` with a `#code` from the spec:
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
