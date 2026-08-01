# frozen_string_literal: true

module BaseHuman
  # Version 1 checksum, spec section 6.2. Rolling polynomial over symbol
  # values, then modulus conversion into the checksum alphabet.
  module Checksum
    INITIAL_STATE = 17
    MULTIPLIER = 37

    module_function

    # Returns the checksum value in [0, modulus).
    def checksum_value(prepared, body, body_index = nil)
      body_index ||= BaseN.alphabet_index(prepared.body_alphabet)
      modulus = prepared.checksum_modulus

      state = INITIAL_STATE
      prepared.profile_id.each_byte do |byte|
        state = (state * MULTIPLIER + byte + 1) % modulus
      end
      state = (state * MULTIPLIER) % modulus
      body.each_char.each_with_index do |ch, pos|
        symbol_value = body_index[ch]
        unless symbol_value
          raise BasehError.new(
            "INVALID_CHARACTER",
            "Body symbol #{ch.inspect} is not in the body alphabet"
          )
        end
        state = (state * MULTIPLIER + symbol_value + pos + 1) % modulus
      end
      state
    end

    # Expected checksum string for a normalized body.
    def calculate_checksum(prepared, body, body_index = nil)
      return "" if prepared.checksum_length.zero?

      body_index ||= BaseN.alphabet_index(prepared.body_alphabet)
      value = checksum_value(prepared, body, body_index)
      BaseN.encode_base_n(value, prepared.checksum_alphabet, prepared.checksum_length)
    end
  end
end
