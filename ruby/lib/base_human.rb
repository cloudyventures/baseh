# frozen_string_literal: true

require "set"
require_relative "base_human/version"
require_relative "base_human/errors"
require_relative "base_human/profile"
require_relative "base_human/basen"
require_relative "base_human/checksum"
require_relative "base_human/feistel"
require_relative "base_human/profiles"
require_relative "base_human/hrc"

# HRC (Human Reference Code) codec. See spec/IMPLEMENTATION_CODEC.md in the
# repository root for the normative specification.
module BaseHuman
  class << self
    # Frozen profile hrc32-v1 (spec 17) with the caller's permutation key.
    def hrc32_v1(key_bytes:, key_id:, rounds: 8)
      Profiles.hrc32_v1(key_bytes: key_bytes, key_id: key_id, rounds: rounds)
    end

    # Frozen profile hrc32s-v1 (spec 17) with the caller's permutation key.
    def hrc32s_v1(key_bytes:, key_id:, rounds: 8)
      Profiles.hrc32s_v1(key_bytes: key_bytes, key_id: key_id, rounds: rounds)
    end
  end
end
