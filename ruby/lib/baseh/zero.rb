# frozen_string_literal: true

module Baseh
  # Zero-config pair over the frozen baseh-medium-v1 profile. No profile
  # object, no key: just the two functions an application needs when it
  # does not want to think about configuration.
  #
  #   Baseh.to_code(481890303)     -> "H3C9-2PEM"
  #   Baseh.from_code("H3C9-2PEM") -> 481890303
  #
  # to_code accepts an Integer or a decimal string of digits. from_code
  # strips every whitespace character (edges and internal), accepts
  # lowercase and the typed aliases (O, I, L) and returns the id as an
  # Integer. Any invalid input raises BasehError, including the rare
  # BLOCKED_CODE identifiers that spell a blocklisted word; no correction
  # attempts are ever made.
  module Zero
    DECIMAL = /\A[0-9]+\z/.freeze
    WHITESPACE = /\s+/.freeze

    ZERO = Baseh.new(Profiles.baseh_medium_v1)

    module_function

    # Encode an identifier with the zero-config Medium profile.
    #
    # @param id [Integer, String] Integer or decimal string of digits
    # @return [String] canonical code
    # @raise [ArgumentError] when id is neither an Integer nor a decimal string
    # @raise [BasehError] OUT_OF_RANGE, BLOCKED_CODE
    def to_code(id)
      value =
        case id
        when Integer then id
        when String
          if DECIMAL.match?(id)
            id.to_i
          else
            raise ArgumentError,
                  "to_code expects a non-negative Integer or a decimal string"
          end
        else
          raise ArgumentError,
                "to_code expects a non-negative Integer or a decimal string"
        end
      ZERO.encode(id: value)
    end

    # Decode a code from the zero-config Medium profile back to its id.
    #
    # @param code [String]
    # @return [Integer]
    # @raise [BasehError] INVALID_LENGTH, INVALID_CHARACTER, INVALID_CHECKSUM
    def from_code(code)
      input = code.is_a?(String) ? code.gsub(WHITESPACE, "") : code
      ZERO.decode(input).id
    end
  end

  class << self
    # See Baseh::Zero.to_code.
    def to_code(id)
      Zero.to_code(id)
    end

    # See Baseh::Zero.from_code.
    def from_code(code)
      Zero.from_code(code)
    end
  end
end
