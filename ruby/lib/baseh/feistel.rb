# frozen_string_literal: true

require "openssl"

module Baseh
  # Balanced Feistel network with cycle walking, spec section 7.3.
  # HMAC-SHA-256 comes from OpenSSL; HMAC and SHA-256 are never implemented
  # by hand (section 7.5).
  module Feistel
    TAG = "BASEH-FEISTEL-V1".b
    MAX_WALKS = 1000

    module_function

    # ceil(log2(capacity)); capacity >= 2 so bits >= 1.
    def bit_length(capacity)
      (capacity - 1).bit_length
    end

    # Low n bits of the HMAC-SHA-256 digest: first ceil(n / 8) bytes read as
    # a big-endian integer and masked with 2^n - 1.
    def low_bits(digest, n)
      byte_count = (n + 7) / 8
      v = digest.byteslice(0, byte_count).unpack("C*").inject(0) { |acc, b| (acc << 8) | b }
      v & ((1 << n) - 1)
    end

    def to_be(value, byte_count)
      return "".b if byte_count.zero?

      bytes = Array.new(byte_count)
      v = value
      (byte_count - 1).downto(0) do |i|
        bytes[i] = v & 0xff
        v >>= 8
      end
      bytes.pack("C*")
    end

    # Normative round message, spec 7.3 step 4. In expandable mode the
    # generation's total code length L is mixed in as ASCII decimal plus a
    # 0x00 terminator after the profileId field (spec 7.3/19.4); fixed-mode
    # messages stay byte-for-byte unchanged.
    def round_message(profile_id, round, right, wr, length = nil)
      "".b
        .concat(TAG)
        .concat(0.chr(Encoding::BINARY))
        .concat(profile_id)
        .concat(0.chr(Encoding::BINARY))
        .concat(length.nil? ? "".b : "#{length}\x00".b)
        .concat(round.chr(Encoding::BINARY))
        .concat(to_be(right, (wr + 7) / 8))
    end

    def hmac(key_bytes, message)
      OpenSSL::HMAC.digest(OpenSSL::Digest.new("sha256"), key_bytes, message)
    end

    def run_rounds(left, right, profile_id, key_bytes, rounds, w0, w1, length)
      rounds.times do |i|
        even = i.even?
        wr = even ? w1 : w0
        wl = even ? w0 : w1
        f = low_bits(hmac(key_bytes, round_message(profile_id, i, right, wr, length)), wl)
        new_left = right
        new_right = left ^ f
        left = new_left
        right = new_right
      end
      [left, right]
    end

    def run_inverse(left, right, profile_id, key_bytes, rounds, w0, w1, length)
      (rounds - 1).downto(0) do |i|
        even = i.even?
        wr = even ? w1 : w0
        wl = even ? w0 : w1
        f = low_bits(hmac(key_bytes, round_message(profile_id, i, left, wr, length)), wl)
        prev_right = left
        prev_left = right ^ f
        left = prev_left
        right = prev_right
      end
      [left, right]
    end

    # Forward permutation with cycle walking. length is expandable mode only
    # (spec 7.3/19.4): the generation's total code length mixed into the round
    # message; omit it in fixed mode.
    def permute(value, capacity, profile_id:, key_bytes:, rounds:, length: nil)
      walk(value, capacity, profile_id, key_bytes, rounds, length) do |left, right, w0, w1|
        run_rounds(left, right, profile_id, key_bytes, rounds, w0, w1, length)
      end
    end

    # Inverse permutation with cycle walking.
    def inverse_permute(value, capacity, profile_id:, key_bytes:, rounds:, length: nil)
      walk(value, capacity, profile_id, key_bytes, rounds, length) do |left, right, w0, w1|
        run_inverse(left, right, profile_id, key_bytes, rounds, w0, w1, length)
      end
    end

    def walk(value, capacity, profile_id, key_bytes, rounds, length)
      bits = bit_length(capacity)
      w1 = bits / 2
      w0 = bits - w1
      v = value
      MAX_WALKS.times do
        left = v >> w1
        right = v & ((1 << w1) - 1)
        out_left, out_right = yield(left, right, w0, w1)
        combined = (out_left << w1) | out_right
        return combined if combined < capacity

        v = combined
      end
      raise BasehError.new(
        "PERMUTATION_FAILURE",
        "Feistel cycle walking exceeded 1000 iterations",
        safe_for_customer: false
      )
    end

    # Only permute and inverse_permute are public; the round machinery is
    # internal to the spec 7.3 permutation.
    class << self
      private :bit_length, :low_bits, :to_be, :round_message, :hmac,
              :run_rounds, :run_inverse, :walk
    end
  end
end
