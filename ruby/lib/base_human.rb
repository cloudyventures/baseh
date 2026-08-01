# frozen_string_literal: true

require "set"
require_relative "base_human/version"
require_relative "base_human/errors"
require_relative "base_human/profanity"
require_relative "base_human/profile"
require_relative "base_human/basen"
require_relative "base_human/checksum"
require_relative "base_human/feistel"
require_relative "base_human/profiles"
require_relative "base_human/baseh"

# BaseH (Human Reference Code) codec. See spec/IMPLEMENTATION_CODEC.md in the
# repository root for the normative specification.
module BaseHuman
  class << self
    # Frozen profile baseh32-v1 (spec 17). Permutation is off unless
    # key_bytes is supplied.
    def baseh32_v1(key_bytes: nil, key_id: nil, rounds: 8)
      Profiles.baseh32_v1(key_bytes: key_bytes, key_id: key_id, rounds: rounds)
    end

    # Frozen profile baseh32s-v1 (spec 17). Permutation is off unless
    # key_bytes is supplied.
    def baseh32s_v1(key_bytes: nil, key_id: nil, rounds: 8)
      Profiles.baseh32s_v1(key_bytes: key_bytes, key_id: key_id, rounds: rounds)
    end
  end
end
