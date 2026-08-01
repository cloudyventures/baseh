# frozen_string_literal: true

module Baseh
  # Fixed-length base-N encoding, spec section 5. Most significant digit first.
  module BaseN
    module_function

    # Spec 5.1. All arithmetic stays in Integer (arbitrary precision).
    def encode_base_n(value, alphabet, length)
      base = alphabet.length
      out = Array.new(length)
      v = value
      (length - 1).downto(0) do |pos|
        digit = v % base
        out[pos] = alphabet[digit]
        v /= base
      end
      out.join
    end

    # Spec 5.2. Raises INVALID_CHARACTER for symbols outside the alphabet.
    def decode_base_n(text, alphabet, index = nil)
      index ||= alphabet_index(alphabet)
      base = alphabet.length
      value = 0
      text.each_char do |ch|
        digit = index[ch]
        if digit.nil?
          raise BasehError.new(
            "INVALID_CHARACTER",
            "Symbol #{ch.inspect} is not in the alphabet"
          )
        end
        value = value * base + digit
      end
      value
    end

    def alphabet_index(alphabet)
      alphabet.each_char.each_with_index.to_h
    end
  end
end
