# frozen_string_literal: true

module Baseh
  # Frozen tier profiles. Each is built from the full alphanumeric set with
  # cumulative visual and spoken strips; the spoken strips interact with the
  # visual ones exactly as the web tools derive them, so the tool capacities
  # match.
  #
  #   Minimum  36 symbols, no checksum, XXX-XXX      2,176,782,336 ids
  #   Light    31 symbols, 2 checksums, XXXX-XXXX      887,503,681 ids
  #   Medium   28 symbols, 2 checksums, XXXX-XXXX      481,890,304 ids (default)
  #   Heavy    26 symbols, 2 checksums, XXXX-XXXX      308,915,776 ids
  #
  # All four keep the typed O/I/L aliases where possible, use a hyphen
  # delimiter at the midpoint and run the default profanity blocklist. Every
  # tier permutes with the frozen published key (FROZEN_KEY_BYTES below): the
  # key is public, so the permutation obscures sequence but is not secrecy.
  # The -p variants are identical but permute with caller-supplied key
  # material instead.
  module Profiles
    OIL_ALIASES = { "O" => "0", "I" => "1", "L" => "1" }.freeze

    # The frozen published permutation key. Public by design: it makes issued
    # codes look non-sequential but offers no secrecy, since anyone can read
    # it here. Never swap it on a live namespace; codes only decode with the
    # key they were issued under. Use the -p variants to supply private key
    # material.
    FROZEN_KEY_BYTES = "baseh-frozen-key-v1".b.freeze

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
        checksum_length: 2,
        separator: "-",
        grouping: [4, 4],
        aliases: { **OIL_ALIASES, "D" => "B", "T" => "P" }
      },
      medium: {
        profile_id: "baseh-medium",
        body_alphabet: "0123456789ACDEFGHJKMPQRUVXYZ",
        checksum_alphabet: "234679ACDEFGHJKMPQRUVXY",
        checksum_length: 2,
        separator: "-",
        grouping: [4, 4],
        # B and S are dropped for looking like 8 and 5; since they can never
        # be issued, a typed B is always an 8 and a typed S always a 5.
        aliases: { **OIL_ALIASES, "B" => "8", "S" => "5", "T" => "P",
                   "N" => "M", "W" => "V" }
      },
      heavy: {
        profile_id: "baseh-heavy",
        body_alphabet: "0123456789ABCEFHJKMPQRVXYZ",
        checksum_alphabet: "234679ACEFHJKMPQRUVXY",
        checksum_length: 2,
        separator: "-",
        grouping: [4, 4],
        aliases: { **OIL_ALIASES, "D" => "B", "T" => "P", "N" => "M",
                   "W" => "V", "S" => "F", "G" => "C" }
      }
    }.freeze

    module_function

    # Permutation every plain tier applies, built from the frozen published
    # key.
    def frozen_permutation
      keyed_permutation(FROZEN_KEY_BYTES, "frozen", 8)
    end

    # Alphanumeric, no safety strips, no checksum, hyphen-delimited XXX-XXX.
    def baseh_minimum_v1
      tier(:minimum, frozen_permutation, false)
    end

    # baseh-minimum permuted with caller-supplied key material.
    def baseh_minimum_p_v1(key_bytes:, key_id: "default", rounds: 8)
      tier(:minimum, keyed_permutation(key_bytes, key_id, rounds), true)
    end

    # Visual light plus spoken light, two checksum symbols, hyphen-delimited.
    def baseh_light_v1
      tier(:light, frozen_permutation, false)
    end

    # baseh-light permuted with caller-supplied key material.
    def baseh_light_p_v1(key_bytes:, key_id: "default", rounds: 8)
      tier(:light, keyed_permutation(key_bytes, key_id, rounds), true)
    end

    # Visual medium plus spoken medium, two checksum symbols, hyphen-delimited. The default.
    def baseh_medium_v1
      tier(:medium, frozen_permutation, false)
    end

    # baseh-medium permuted with caller-supplied key material.
    def baseh_medium_p_v1(key_bytes:, key_id: "default", rounds: 8)
      tier(:medium, keyed_permutation(key_bytes, key_id, rounds), true)
    end

    # Conservative alphabet plus spoken heavy, two checksum symbols, hyphen-delimited.
    def baseh_heavy_v1
      tier(:heavy, frozen_permutation, false)
    end

    # baseh-heavy permuted with caller-supplied key material.
    def baseh_heavy_p_v1(key_bytes:, key_id: "default", rounds: 8)
      tier(:heavy, keyed_permutation(key_bytes, key_id, rounds), true)
    end

    # Spec 17.1: "the full alphanumeric set minus 0 and O (34 symbols; the
    # zero ban of section 19.2)". The JSON bodyAlphabet string printed in
    # section 17.1 lists only 32 symbols (it also drops I and L), but the
    # prose, the generation-capacity table (34^(L-2); 1,156 ids at length 4)
    # and the checksum modulus (35^2 = 1,225) are all consistent only with
    # 34, and the zero ban removes exactly 0 and O. The 34-symbol alphabet
    # is the one that satisfies the normative numbers.
    EXPANDABLE_BODY = "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ"

    # The frozen expandable tier; the recommended starting point for new
    # namespaces. Four characters while the namespace is small, gaining one
    # symbol automatically as issuance climbs past each generation's
    # capacity. The checksum alphabet derives at preparation as "0" plus the
    # body (35 symbols, modulus 1225); generations 4 and 5 carry the spec 22
    # short checksum of one symbol (modulus 35), with the full two symbols
    # from six characters up, where the hyphen also appears, split by the
    # balanced grouping of spec 19.5.
    def baseh_expandable_v1
      expandable_tier(frozen_permutation, false)
    end

    # baseh-expandable permuted with caller-supplied key material.
    def baseh_expandable_p_v1(key_bytes:, key_id: "default", rounds: 8)
      expandable_tier(keyed_permutation(key_bytes, key_id, rounds), true)
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
        profanity: { mode: "blocklist" },
        max_repetition: 4
      }
    end
    # Builds a fresh mutable profile for the expandable tier, plain or (-p)
    # keyed. Every call returns new strings, arrays and hashes.
    def expandable_tier(permutation, p_suffix)
      {
        profile_id: "baseh-expandable" + (p_suffix ? "-p" : "") + "-v1",
        mode: "expandable",
        body_alphabet: EXPANDABLE_BODY.dup,
        min_length: 4,
        checksum_alphabet: ("0" + EXPANDABLE_BODY).dup,
        checksum_length: 2,
        short_checksum_length: 1,
        short_checksum_until: 5,
        case_sensitive: false,
        separator: "-",
        separator_min_length: 6,
        grouping: [],
        aliases: { **OIL_ALIASES, "T" => "P", "N" => "M", "W" => "V" },
        permutation: permutation,
        profanity: { mode: "blocklist" },
        max_repetition: 4
      }
    end
    private_class_method :frozen_permutation, :keyed_permutation, :tier, :expandable_tier
  end
end
