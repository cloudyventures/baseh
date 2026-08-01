# frozen_string_literal: true

module Baseh
  # Version 1 checksum, spec section 6.2. Rolling polynomial over symbol
  # values, then modulus conversion into the checksum alphabet.
  module Checksum
    INITIAL_STATE = 17
    MULTIPLIER = 37

    module_function

    # Returns the checksum value in [0, modulus).
    # Spec 22: expandable generations may pass a shorter effective checksum
    # length; the modulus is then S^length instead of the profile default.
    def checksum_value(prepared, body, body_index = nil, length = prepared.checksum_length)
      body_index ||= BaseN.alphabet_index(prepared.body_alphabet)
      modulus =
        if length == prepared.checksum_length
          prepared.checksum_modulus
        else
          [prepared.checksum_alphabet.length, 1].max**length
        end

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
    def calculate_checksum(prepared, body, body_index = nil, length = prepared.checksum_length)
      return "" if length.zero?

      body_index ||= BaseN.alphabet_index(prepared.body_alphabet)
      value = checksum_value(prepared, body, body_index, length)
      BaseN.encode_base_n(value, prepared.checksum_alphabet, length)
    end
  end
end
