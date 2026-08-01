# frozen_string_literal: true

module Baseh
  # Codec engine, spec sections 8 through 12 and 18. Instances wrap one
  # validated profile and are stateless and safe to share across threads.
  class Baseh
    # Built-in spoken-confusion candidate maps, spec section 3.3.
    # Pairs apply to body symbols only, never to checksum characters.
    CONFUSION_MAPS = {
      light: {
        "B" => %w[D], "D" => %w[B], "P" => %w[T], "T" => %w[P]
      }.freeze,
      medium: {
        "B" => %w[D], "D" => %w[B], "P" => %w[T], "T" => %w[P],
        "M" => %w[N], "N" => %w[M], "V" => %w[W], "W" => %w[V]
      }.freeze,
      heavy: {
        "B" => %w[D], "D" => %w[B], "P" => %w[T], "T" => %w[P],
        "M" => %w[N], "N" => %w[M], "V" => %w[W], "W" => %w[V],
        "F" => %w[S], "S" => %w[F], "C" => %w[G], "G" => %w[C]
      }.freeze
    }.freeze

    MAX_CANDIDATES = 64

    ASCII_WS = /\A[\t\n\v\f\r ]+|[\t\n\v\f\r ]+\z/.freeze

    # Result of a successful decode.
    DecodeResult = Struct.new(:id, :canonical_code, :corrected, keyword_init: true)

    # Result of validate, which never raises on user input.
    ValidateResult = Struct.new(:valid, :canonical_code, :reason, keyword_init: true)

    attr_reader :profile

    # @param profile [Hash] profile definition per spec 2.1 (symbol keys)
    # @raise [BasehError] INVALID_PROFILE when the profile violates spec 2.2
    def initialize(profile)
      @profile = Profile.prepare(profile)
      @body_index = BaseN.alphabet_index(@profile.body_alphabet)
    end

    # Spec section 4. Capacity is an arbitrary-precision Integer.
    def capacity
      @profile.capacity
    end

    # Spec section 8, with the spec 18.2 blocklist scan over the raw code.
    #
    # @param id [Integer] 0 <= id < capacity
    # @return [String] canonical code (grouped only when a separator is set)
    # @raise [BasehError] OUT_OF_RANGE, PERMUTATION_FAILURE, BLOCKED_CODE
    def encode(id:)
      unless id.is_a?(Integer)
        raise TypeError, "id must be an Integer"
      end
      if id.negative? || id >= @profile.capacity
        raise BasehError.new("OUT_OF_RANGE", "ID #{id} is outside the profile capacity")
      end

      value = id
      perm = @profile.permutation
      if perm[:enabled]
        value = Feistel.permute(
          value, @profile.capacity,
          profile_id: @profile.profile_id,
          key_bytes: perm[:key_bytes],
          rounds: perm[:rounds]
        )
      end

      body = BaseN.encode_base_n(value, @profile.body_alphabet, @profile.body_length)
      checksum = Checksum.calculate_checksum(@profile, body, @body_index)
      raw = body + checksum
      check_blocklist!(raw)
      format_raw(raw)
    end

    # Spec section 9.
    #
    # @param input [String]
    # @param accept_spaces [Boolean] strip ASCII spaces before validation
    # @param try_correction [Boolean] attempt single-symbol spoken correction
    # @param confusion_profile [:none, :light, :medium, :heavy]
    # @param max_corrections [0, 1]
    # @return [DecodeResult]
    # @raise [BasehError] INVALID_LENGTH, INVALID_CHARACTER, INVALID_CHECKSUM,
    #   AMBIGUOUS_INPUT, TOO_MANY_CANDIDATES, PERMUTATION_FAILURE, BLOCKED_CODE
    def decode(input, accept_spaces: false, try_correction: false,
               confusion_profile: :none, max_corrections: 1)
      unless input.is_a?(String)
        raise BasehError.new("INVALID_CHARACTER", "Input must be a string")
      end

      raw = normalize(input, accept_spaces)
      body = raw.slice(0, @profile.body_length)
      supplied_checksum = raw.slice(@profile.body_length..) || ""

      # normalize validates every symbol against the union of the body and
      # checksum alphabets (spec 3.1 step 6). A checksum-only symbol in a
      # body slot is INVALID_CHARACTER before any checksum work. A body-only
      # symbol in the checksum slot survives to the checksum comparison and
      # fails as INVALID_CHECKSUM; the frozen error vectors require that
      # exact outcome.
      body.each_char do |ch|
        next if @body_index.key?(ch)

        raise BasehError.new(
          "INVALID_CHARACTER",
          "Symbol #{ch.inspect} cannot appear in the body"
        )
      end

      if Checksum.calculate_checksum(@profile, body, @body_index) != supplied_checksum
        unless try_correction && max_corrections != 0
          raise BasehError.new(
            "INVALID_CHECKSUM",
            "The reference code did not pass validation"
          )
        end
        map = confusion_map(confusion_profile)
        valid = {}
        generate_candidates(body, map, max_corrections).each do |candidate|
          if Checksum.calculate_checksum(@profile, candidate, @body_index) == supplied_checksum
            valid[candidate] = true
          end
        end
        case valid.size
        when 0
          raise BasehError.new(
            "INVALID_CHECKSUM",
            "The reference code did not pass validation"
          )
        when 1
          body = valid.keys.first
        else
          raise BasehError.new(
            "AMBIGUOUS_INPUT",
            "The reference code matches more than one record",
            safe_for_customer: false
          )
        end
      end

      value = BaseN.decode_base_n(body, @profile.body_alphabet, @body_index)
      perm = @profile.permutation
      if perm[:enabled]
        value = Feistel.inverse_permute(
          value, @profile.capacity,
          profile_id: @profile.profile_id,
          key_bytes: perm[:key_bytes],
          rounds: perm[:rounds]
        )
      end

      # encode re-scans the blocklist, so decode raises BLOCKED_CODE when
      # reconstructing a canonical form that could never have been issued
      # (spec 18.2).
      canonical_code = encode(id: value)
      corrected = raw != canonical_raw(canonical_code)
      DecodeResult.new(id: value, canonical_code: canonical_code, corrected: corrected)
    end

    # Spec section 12.4. Never raises on user input; returns a ValidateResult
    # with the failing error code in #reason instead.
    def validate(input, **options)
      result = decode(input, **options)
      ValidateResult.new(valid: true, canonical_code: result.canonical_code)
    rescue BasehError => e
      ValidateResult.new(valid: false, reason: e.code)
    end

    # Spec 3.1 normalization, steps 1-9, with the spec 3.4 re-pad. Returns
    # the raw unformatted string.
    def normalize(input, accept_spaces)
      s = input.gsub(ASCII_WS, "")
      s = s.delete(@profile.separator) unless @profile.separator.empty?
      s = s.delete(" ") if accept_spaces
      s = s.upcase unless @profile.case_sensitive
      s = s.each_char.map { |ch| @profile.aliases.fetch(ch, ch) }.join

      s.each_char do |ch|
        next if @body_index.key?(ch) || @profile.checksum_alphabet.include?(ch)

        raise BasehError.new(
          "INVALID_CHARACTER",
          "Symbol #{ch.inspect} is not accepted"
        )
      end

      expected = @profile.body_length + @profile.checksum_length
      # Spec 3.4: a code that lost leading zero body symbols is re-padded
      # with the body zero symbol. The checksum symbols always remain, so
      # the split point is unambiguous. A fully stripped no-checksum code
      # would be empty and stays a length error.
      if s.length < expected && s.length >= [@profile.checksum_length, 1].max
        s = @profile.body_alphabet[0] * (expected - s.length) + s
      end
      if s.length != expected
        raise BasehError.new(
          "INVALID_LENGTH",
          "Expected #{expected} symbols, got #{s.length}"
        )
      end
      s
    end

    # Spec section 10. Substitution-only generation, capped and deduplicated.
    def generate_candidates(body, confusion_map, max_edits = 1)
      return [] if max_edits.zero?

      results = {}
      chars = body.chars
      chars.each_index do |pos|
        Array(confusion_map[chars[pos]]).each do |replacement|
          candidate = chars.dup
          candidate[pos] = replacement
          results[candidate.join] = true
          next unless results.size > MAX_CANDIDATES

          raise BasehError.new(
            "TOO_MANY_CANDIDATES",
            "Candidate generation exceeded 64 entries",
            safe_for_customer: false
          )
        end
      end
      results.keys
    end

    private

    # Spec 18.2: case-insensitive substring scan over the raw unformatted
    # code. BLOCKED_CODE is an issuance decision, not an end-user condition.
    def check_blocklist!(raw)
      return if @profile.blocklist.empty?

      upper = raw.upcase
      @profile.blocklist.each do |word|
        next unless upper.include?(word)

        raise BasehError.new(
          "BLOCKED_CODE",
          "The generated reference contains a blocked substring",
          safe_for_customer: false
        )
      end
    end

    def confusion_map(name)
      case name
      when :none, "none" then {}.freeze
      when :light, "light" then CONFUSION_MAPS[:light]
      when :medium, "medium" then CONFUSION_MAPS[:medium]
      when :heavy, "heavy" then CONFUSION_MAPS[:heavy]
      else
        raise ArgumentError, "unknown confusion profile #{name.inspect}"
      end
    end

    def format_raw(raw)
      return raw if @profile.separator.empty?

      parts = []
      offset = 0
      @profile.grouping.each do |size|
        parts << raw.slice(offset, size)
        offset += size
      end
      parts.join(@profile.separator)
    end

    def canonical_raw(canonical_code)
      return canonical_code if @profile.separator.empty?

      canonical_code.delete(@profile.separator)
    end
  end
end
