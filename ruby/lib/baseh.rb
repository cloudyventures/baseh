# frozen_string_literal: true

require "set"
require_relative "baseh/version"
require_relative "baseh/errors"
require_relative "baseh/profanity"
require_relative "baseh/profile"
require_relative "baseh/basen"
require_relative "baseh/checksum"
require_relative "baseh/feistel"
require_relative "baseh/profiles"
require_relative "baseh/baseh"
require_relative "baseh/zero"

# baseH (Human Reference Code) codec. See spec/IMPLEMENTATION_CODEC.md in the
# repository root for the normative specification.
module Baseh
  # The frozen published permutation key used by every plain tier helper.
  # Public by design: it makes issued codes look non-sequential but offers no
  # secrecy, since anyone can read it here. Never swap it on a live
  # namespace; codes only decode with the key they were issued under. Use
  # the -p helpers to supply private key material.
  FROZEN_KEY_BYTES = Profiles::FROZEN_KEY_BYTES

  class << self
    # Frozen tier baseh-minimum-v1: alphanumeric with no strips, no checksum,
    # hyphen-delimited XXX-XXX. Permutes with the frozen published key.
    def baseh_minimum_v1
      Profiles.baseh_minimum_v1
    end

    # baseh-minimum permuted with caller-supplied key material. key_bytes is required.
    def baseh_minimum_p_v1(key_bytes:, key_id: "default", rounds: 8)
      Profiles.baseh_minimum_p_v1(key_bytes: key_bytes, key_id: key_id, rounds: rounds)
    end

    # Frozen tier baseh-light-v1: visual light plus spoken light, two
    # checksum symbols, hyphen-delimited. Permutes with the frozen published
    # key.
    def baseh_light_v1
      Profiles.baseh_light_v1
    end

    # baseh-light permuted with caller-supplied key material. key_bytes is required.
    def baseh_light_p_v1(key_bytes:, key_id: "default", rounds: 8)
      Profiles.baseh_light_p_v1(key_bytes: key_bytes, key_id: key_id, rounds: rounds)
    end

    # Frozen tier baseh-medium-v1: visual medium plus spoken medium, two
    # checksum symbols, hyphen-delimited. The default. Permutes with the
    # frozen published key.
    def baseh_medium_v1
      Profiles.baseh_medium_v1
    end

    # baseh-medium permuted with caller-supplied key material. key_bytes is required.
    def baseh_medium_p_v1(key_bytes:, key_id: "default", rounds: 8)
      Profiles.baseh_medium_p_v1(key_bytes: key_bytes, key_id: key_id, rounds: rounds)
    end

    # Frozen tier baseh-heavy-v1: conservative alphabet plus spoken heavy,
    # two checksum symbols, hyphen-delimited. Permutes with the frozen
    # published key.
    def baseh_heavy_v1
      Profiles.baseh_heavy_v1
    end

    # baseh-heavy permuted with caller-supplied key material. key_bytes is required.
    def baseh_heavy_p_v1(key_bytes:, key_id: "default", rounds: 8)
      Profiles.baseh_heavy_p_v1(key_bytes: key_bytes, key_id: key_id, rounds: rounds)
    end
  end
end
