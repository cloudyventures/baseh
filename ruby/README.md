# base-human

Ruby port of the HRC (Human Reference Code) codec. Encodes integer IDs as
fixed-length, checksummed, human-friendly reference codes with an optional
reversible feistel-v1 permutation. The normative spec is
`spec/IMPLEMENTATION_CODEC.md` in the monorepo root.

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

## Usage

```ruby
require "base_human"

# Supply your own permutation key material. Keep it in a secret manager and
# never change it for a live profile.
profile = BaseHuman.hrc32_v1(
  key_bytes: File.binread("path/to/key.bin"),
  key_id: "prod-01"
)

hrc = BaseHuman::Hrc.new(profile)

code = hrc.encode(id: 123_456)             # => "AAC-...-X" style grouped code

result = hrc.decode(code)
result.id                                  # => 123456
result.canonical_code                      # => canonical, grouped form
result.corrected                           # => true when input needed correction

hrc.capacity                               # => 1073741824

check = hrc.validate("000-000-0")
check.valid                                # => false
check.reason                               # => "INVALID_CHECKSUM"

# Spoken-confusion correction
result = hrc.decode("TB1-4QD-F", try_correction: true, confusion_profile: :light)
```

`BaseHuman.hrc32s_v1(...)` gives the two-checksum-digit self-service profile.
Both helpers take `rounds:` (default 8) after `key_bytes:` and `key_id:`.

All failures raise `BaseHuman::HrcError` with a `#code` from the spec:
`INVALID_PROFILE`, `OUT_OF_RANGE`, `PERMUTATION_FAILURE`, `INVALID_LENGTH`,
`INVALID_CHARACTER`, `INVALID_CHECKSUM`, `AMBIGUOUS_INPUT` and
`TOO_MANY_CANDIDATES`. `validate` never raises on user input.

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
