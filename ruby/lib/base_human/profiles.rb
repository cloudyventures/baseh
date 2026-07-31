# frozen_string_literal: true

module BaseHuman
  # Frozen profiles from spec section 17. Application-specific permutation
  # keys are never part of the frozen profile; callers supply their own
  # key_id and key_bytes (a binary String).
  module Profiles
    BODY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".freeze
    CHECKSUM_ALPHABET = "234679ACDEFGHJKMNPQRTUVWXY".freeze
    ALIASES = { "O" => "0", "I" => "1", "L" => "1" }.freeze

    module_function

    # hrc32-v1: 6 body + 1 checksum, feistel-v1 permutation.
    # Assisted-support use; structured single-substitution miss rate about
    # 1.2 percent per position (spec 6.3).
    def hrc32_v1(key_bytes:, key_id:, rounds: 8)
      {
        profile_id: "hrc32-v1",
        body_alphabet: BODY_ALPHABET,
        body_length: 6,
        checksum_alphabet: CHECKSUM_ALPHABET,
        checksum_length: 1,
        case_sensitive: false,
        separator: "-",
        grouping: [3, 3, 1],
        aliases: ALIASES.dup,
        permutation: {
          enabled: true,
          algorithm: "feistel-v1",
          key_id: key_id,
          key_bytes: key_bytes,
          rounds: rounds
        }
      }
    end

    # hrc32s-v1: 6 body + 2 checksum, feistel-v1 permutation.
    # Self-service use; provably detects all single-symbol substitutions and
    # all adjacent transpositions (spec 6.3).
    def hrc32s_v1(key_bytes:, key_id:, rounds: 8)
      profile = hrc32_v1(key_bytes: key_bytes, key_id: key_id, rounds: rounds)
      profile.merge(profile_id: "hrc32s-v1", checksum_length: 2, grouping: [3, 3, 2])
    end
  end
end
