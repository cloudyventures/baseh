# frozen_string_literal: true

module Baseh
  # Frozen tier profiles. Each is built from the full alphanumeric set with
  # cumulative visual and spoken strips; the spoken strips interact with the
  # visual ones exactly as the web tools derive them, so the tool capacities
  # match.
  #
  #   Minimum  36 symbols, no checksum      2,176,782,336 ids
  #   Light    31 symbols, 1 checksum         887,503,681 ids
  #   Medium   28 symbols, 1 checksum         481,890,304 ids (default)
  #   Heavy    26 symbols, 1 checksum         308,915,776 ids
  #
  # All four keep the typed O/I/L aliases where possible and run the default
  # profanity blocklist. Minimum also uses a hyphen delimiter; the rest have
  # none. The _p variants are identical but with feistel-v1 permutation and
  # require caller-supplied key material.
  module Profiles
    OIL_ALIASES = { "O" => "0", "I" => "1", "L" => "1" }.freeze

    # Tier shapes shared by the plain and (-p) keyed helpers. The values are
    # thawed on every build, so each helper returns a fresh mutable profile.
    TIERS = {
      minimum: {
        profile_id: "baseh-minimum",
        body_alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        checksum_alphabet: "",
        checksum_length: 0,
        separator: "-",
        grouping: [3, 3],
        aliases: {}
      },
      light: {
        profile_id: "baseh-light",
        body_alphabet: "0123456789ABCEFGHJKMNPQRSUVWXYZ",
        checksum_alphabet: "234679ACEFGHJKMNPQRUVWXY",
        checksum_length: 1,
        separator: "",
        grouping: [],
        aliases: { **OIL_ALIASES, "D" => "B", "T" => "P" }
      },
      medium: {
        profile_id: "baseh-medium",
        body_alphabet: "0123456789ACDEFGHJKMPQRUVXYZ",
        checksum_alphabet: "234679ACDEFGHJKMPQRUVXY",
        checksum_length: 1,
        separator: "",
        grouping: [],
        aliases: { **OIL_ALIASES, "T" => "P", "N" => "M", "W" => "V" }
      },
      heavy: {
        profile_id: "baseh-heavy",
        body_alphabet: "0123456789ABCEFHJKMPQRVXYZ",
        checksum_alphabet: "234679ACEFHJKMPQRUVXY",
        checksum_length: 1,
        separator: "",
        grouping: [],
        aliases: { **OIL_ALIASES, "D" => "B", "T" => "P", "N" => "M",
                   "W" => "V", "S" => "F", "G" => "C" }
      }
    }.freeze

    module_function

    # Alphanumeric, no safety strips, no checksum, hyphen-delimited XXX-XXX.
    def baseh_minimum_v1
      tier(:minimum, { enabled: false }, false)
    end

    # baseh-minimum with feistel-v1 permutation. key_bytes is required.
    def baseh_minimum_p_v1(key_bytes:, key_id: "default", rounds: 8)
      tier(:minimum, keyed_permutation(key_bytes, key_id, rounds), true)
    end

    # Visual light plus spoken light, one checksum symbol.
    def baseh_light_v1
      tier(:light, { enabled: false }, false)
    end

    # baseh-light with feistel-v1 permutation. key_bytes is required.
    def baseh_light_p_v1(key_bytes:, key_id: "default", rounds: 8)
      tier(:light, keyed_permutation(key_bytes, key_id, rounds), true)
    end

    # Visual medium plus spoken medium, one checksum symbol. The default.
    def baseh_medium_v1
      tier(:medium, { enabled: false }, false)
    end

    # baseh-medium with feistel-v1 permutation. key_bytes is required.
    def baseh_medium_p_v1(key_bytes:, key_id: "default", rounds: 8)
      tier(:medium, keyed_permutation(key_bytes, key_id, rounds), true)
    end

    # Conservative alphabet plus spoken heavy, one checksum symbol.
    def baseh_heavy_v1
      tier(:heavy, { enabled: false }, false)
    end

    # baseh-heavy with feistel-v1 permutation. key_bytes is required.
    def baseh_heavy_p_v1(key_bytes:, key_id: "default", rounds: 8)
      tier(:heavy, keyed_permutation(key_bytes, key_id, rounds), true)
    end

    # feistel-v1 permutation block for the keyed (p) helpers.
    def keyed_permutation(key_bytes, key_id, rounds)
      {
        enabled: true,
        algorithm: "feistel-v1",
        key_id: key_id,
        key_bytes: key_bytes,
        rounds: rounds
      }
    end

    # Builds a fresh mutable profile for a tier. Every call returns new
    # strings, arrays and hashes so callers can load a default and modify it.
    def tier(tier_name, permutation, p_suffix)
      shape = TIERS.fetch(tier_name)
      {
        profile_id: shape[:profile_id] + (p_suffix ? "-p" : "") + "-v1",
        body_alphabet: shape[:body_alphabet].dup,
        body_length: 6,
        checksum_alphabet: shape[:checksum_alphabet].dup,
        checksum_length: shape[:checksum_length],
        case_sensitive: false,
        separator: shape[:separator].dup,
        grouping: shape[:grouping].dup,
        aliases: shape[:aliases].dup,
        permutation: permutation,
        profanity: { mode: "blocklist" }
      }
    end
    private_class_method :keyed_permutation, :tier
  end
end
