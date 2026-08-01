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

    # Frozen tier baseh-expandable-v1: variable-length codes, four characters
    # while the namespace is small and growing one symbol per generation.
    # Permutes per generation with the frozen published key.
    def baseh_expandable_v1
      Profiles.baseh_expandable_v1
    end

    # baseh-expandable permuted with caller-supplied key material. key_bytes is required.
    def baseh_expandable_p_v1(key_bytes:, key_id: "default", rounds: 8)
      Profiles.baseh_expandable_p_v1(key_bytes: key_bytes, key_id: key_id, rounds: rounds)
    end

    # Zero-config facade over the frozen baseh-expandable-v1 profile, the
    # recommended default for new namespaces. Most applications never need a
    # profile object at all: these two methods share one lazily constructed,
    # stateless codec instance (thread-safe once built, per Baseh::Baseh).
    #
    #   Baseh.encode(123456)        -> String canonical code
    #   Baseh.decode(code).id       -> 123456
    #
    # decode returns the full DecodeResult (id, canonical_code, corrected),
    # exactly as the instance API does.

    # Encode an identifier with the default expandable profile.
    #
    # @param id [Integer] any non-negative id
    # @return [String] canonical code
    # @raise [BasehError] OUT_OF_RANGE, BLOCKED_CODE
    def encode(id)
      default.encode(id: id)
    end

    # Decode a code from the default expandable profile.
    #
    # @param input [String]
    # @param options keyword options of Baseh::Baseh#decode (accept_spaces:,
    #   try_correction:, confusion_profile:, max_corrections:)
    # @return [Baseh::Baseh::DecodeResult]
    # @raise [BasehError] same codes as the instance decode
    def decode(input, **options)
      default.decode(input, **options)
    end

    # Live as-you-type inspection of input against the default expandable
    # profile (spec 12.5). Never raises on user input.
    #
    # @param input [String]
    # @return [Baseh::Baseh::InspectResult]
    def inspect(input)
      default.inspect(input)
    end

    # The shared default-profile codec, built on first use.
    def default
      @default ||= Baseh.new(Profiles.baseh_expandable_v1)
    end
  end
end
