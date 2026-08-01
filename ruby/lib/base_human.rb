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
    # Frozen tier baseh-minimum-v1: alphanumeric with no strips, no checksum,
    # hyphen-delimited XXX-XXX. Permutation off.
    def baseh_minimum_v1
      Profiles.baseh_minimum_v1
    end

    # baseh-minimum with feistel-v1 permutation. key_bytes is required.
    def baseh_minimum_p_v1(key_bytes:, key_id: "default", rounds: 8)
      Profiles.baseh_minimum_p_v1(key_bytes: key_bytes, key_id: key_id, rounds: rounds)
    end

    # Frozen tier baseh-light-v1: visual light plus spoken light, one
    # checksum symbol. Permutation off.
    def baseh_light_v1
      Profiles.baseh_light_v1
    end

    # baseh-light with feistel-v1 permutation. key_bytes is required.
    def baseh_light_p_v1(key_bytes:, key_id: "default", rounds: 8)
      Profiles.baseh_light_p_v1(key_bytes: key_bytes, key_id: key_id, rounds: rounds)
    end

    # Frozen tier baseh-medium-v1: visual medium plus spoken medium, one
    # checksum symbol. The default. Permutation off.
    def baseh_medium_v1
      Profiles.baseh_medium_v1
    end

    # baseh-medium with feistel-v1 permutation. key_bytes is required.
    def baseh_medium_p_v1(key_bytes:, key_id: "default", rounds: 8)
      Profiles.baseh_medium_p_v1(key_bytes: key_bytes, key_id: key_id, rounds: rounds)
    end

    # Frozen tier baseh-heavy-v1: conservative alphabet plus spoken heavy,
    # one checksum symbol. Permutation off.
    def baseh_heavy_v1
      Profiles.baseh_heavy_v1
    end

    # baseh-heavy with feistel-v1 permutation. key_bytes is required.
    def baseh_heavy_p_v1(key_bytes:, key_id: "default", rounds: 8)
      Profiles.baseh_heavy_p_v1(key_bytes: key_bytes, key_id: key_id, rounds: rounds)
    end
  end
end
