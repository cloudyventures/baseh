# frozen_string_literal: true

module BaseHuman
  # Codec engine, spec sections 8 through 12. Instances wrap one validated
  # profile and are stateless and safe to share across threads.
  class Hrc
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
    # @raise [HrcError] INVALID_PROFILE when the profile violates spec 2.2
    def initialize(profile)
      @profile = Profile.prepare(profile)
      @body_index = BaseN.alphabet_index(@profile.body_alphabet)
    end

    # Spec section 4. Capacity is an arbitrary-precision Integer.
    def capacity
      @profile.capacity
    end

    # Spec section 8.
    #
    # @param id [Integer] 0 <= id < capacity
    # @return [String] canonical, grouped code
    # @raise [HrcError] OUT_OF_RANGE, PERMUTATION_FAILURE
    def encode(id:)
      unless id.is_a?(Integer)
        raise TypeError, "id must be an Integer"
      end
      if id.negative? || id >= @profile.capacity
        raise HrcError.new("OUT_OF_RANGE", "ID #{id} is outside the profile capacity")
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
      format_raw(body + checksum)
    end

    # Spec section 9.
    #
    # @param input [String]
    # @param accept_spaces [Boolean] strip ASCII spaces before validation
    # @param try_correction [Boolean] attempt single-symbol spoken correction
    # @param confusion_profile [:none, :light, :medium, :heavy]
    # @param max_corrections [0, 1]
    # @return [DecodeResult]
    # @raise [HrcError] INVALID_LENGTH, INVALID_CHARACTER, INVALID_CHECKSUM,
    #   AMBIGUOUS_INPUT, TOO_MANY_CANDIDATES, PERMUTATION_FAILURE
    def decode(input, accept_spaces: false, try_correction: false,
               confusion_profile: :none, max_corrections: 1)
      unless input.is_a?(String)
        raise HrcError.new("INVALID_CHARACTER", "Input must be a string")
      end

      raw = normalize(input, accept_spaces)
      body = raw.slice(0, @profile.body_length)
      supplied_checksum = raw.slice(@profile.body_length..) || ""

      body.each_char do |ch|
        next if @profile.body_alphabet.include?(ch)

        raise HrcError.new(
          "INVALID_CHARACTER",
          "Symbol #{ch.inspect} cannot appear in the body"
        )
      end
      supplied_checksum.each_char do |ch|
        next if @profile.checksum_alphabet.include?(ch)

        raise HrcError.new(
          "INVALID_CHARACTER",
          "Symbol #{ch.inspect} cannot appear in the checksum"
        )
      end

      if Checksum.calculate_checksum(@profile, body, @body_index) != supplied_checksum
        unless try_correction && max_corrections != 0
          raise HrcError.new(
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
          raise HrcError.new(
            "INVALID_CHECKSUM",
            "The reference code did not pass validation"
          )
        when 1
          body = valid.keys.first
        else
          raise HrcError.new(
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

      canonical_code = encode(id: value)
      corrected = raw != canonical_code.delete(@profile.separator)
      DecodeResult.new(id: value, canonical_code: canonical_code, corrected: corrected)
    end

    # Spec section 12.4. Never raises on user input; returns a ValidateResult
    # with the failing error code in #reason instead.
    def validate(input, **options)
      result = decode(input, **options)
      ValidateResult.new(valid: true, canonical_code: result.canonical_code)
    rescue HrcError => e
      ValidateResult.new(valid: false, reason: e.code)
    end

    # Spec 3.1 normalization, steps 1-7. Returns the raw unformatted string.
    def normalize(input, accept_spaces)
      s = input.gsub(ASCII_WS, "")
      s = s.delete(@profile.separator) unless @profile.separator.empty?
      s = s.delete(" ") if accept_spaces
      s = s.upcase unless @profile.case_sensitive
      s = s.each_char.map { |ch| @profile.aliases.fetch(ch, ch) }.join

      s.each_char do |ch|
        next if @body_index.key?(ch) || @profile.checksum_alphabet.include?(ch)

        raise HrcError.new(
          "INVALID_CHARACTER",
          "Symbol #{ch.inspect} is not accepted"
        )
      end

      expected = @profile.body_length + @profile.checksum_length
      if s.length != expected
        raise HrcError.new(
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

          raise HrcError.new(
            "TOO_MANY_CANDIDATES",
            "Candidate generation exceeded 64 entries",
            safe_for_customer: false
          )
        end
      end
      results.keys
    end

    private

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
  end
end
