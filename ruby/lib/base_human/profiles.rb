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

    # baseh32-v1: 6 body + 1 checksum, permutation off by default, no
    # separator. Assisted-support use; structured single-substitution miss
    # rate about 1.2 percent per position (spec 6.3). Supply key_bytes to opt
    # into feistel-v1 permutation.
    def baseh32_v1(key_bytes: nil, key_id: nil, rounds: 8)
      {
        profile_id: "baseh32-v1",
        body_alphabet: BODY_ALPHABET,
        body_length: 6,
        checksum_alphabet: CHECKSUM_ALPHABET,
        checksum_length: 1,
        case_sensitive: false,
        separator: "",
        grouping: [],
        aliases: ALIASES.dup,
        permutation: permutation_for(key_bytes: key_bytes, key_id: key_id, rounds: rounds),
        profanity: { mode: "none" }
      }
    end

    # baseh32s-v1: 6 body + 2 checksum, permutation off by default.
    # Self-service use; provably detects all single-symbol substitutions and
    # all adjacent transpositions (spec 6.3). Supply key_bytes to opt into
    # feistel-v1 permutation.
    def baseh32s_v1(key_bytes: nil, key_id: nil, rounds: 8)
      profile = baseh32_v1(key_bytes: key_bytes, key_id: key_id, rounds: rounds)
      profile.merge(profile_id: "baseh32s-v1", checksum_length: 2)
    end

    # Permutation block for the frozen helpers: disabled without key_bytes,
    # feistel-v1 with them.
    def permutation_for(key_bytes:, key_id:, rounds:)
      return { enabled: false } unless key_bytes

      {
        enabled: true,
        algorithm: "feistel-v1",
        key_id: key_id || "default",
        key_bytes: key_bytes,
        rounds: rounds
      }
    end
    private_class_method :permutation_for
  end
end
