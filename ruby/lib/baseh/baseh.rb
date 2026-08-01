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
    # Spec 12.3: fixed mode only; expandable profiles have no single
    # capacity (use the per-generation formulas of spec 19.1).
    def capacity
      if @profile.mode != "fixed"
        raise BasehError.new(
          "INVALID_PROFILE",
          "capacity is only defined for fixed-mode profiles",
          safe_for_customer: false
        )
      end
      @profile.capacity
    end

    # Spec 19.1. First id of generation length: the sum of A^(k-K) for k
    # from minLength through length-1.
    def generation_base(length)
      a = @profile.body_alphabet.length
      base = 0
      cap = a**(@profile.min_length - @profile.checksum_length)
      @profile.min_length.upto(length - 1) do |_l|
        base += cap
        cap *= a
      end
      base
    end

    # Spec 19.1. Ids held by generation length: A^(length-K).
    def generation_capacity(length)
      @profile.body_alphabet.length**(length - @profile.checksum_length)
    end

    # Smallest generation whose range holds id, per spec 19.6.
    def generation_for_id(id)
      l = @profile.min_length
      base = 0
      cap = generation_capacity(l)
      while id >= base + cap
        base += cap
        cap *= @profile.body_alphabet.length
        l += 1
      end
      l
    end

    # Spec 19.5. Balanced grouping: the split is a pure function of the total
    # length — g = max(2, ceil(L / 5)) groups differing in size by at most
    # one, larger groups to the left. There is no configurable pattern in
    # expandable mode (grouping must be empty, section 2.2).
    def self.expandable_grouping(length)
      g = [2, (length + 4) / 5].max
      base = length / g
      return [length] if base < 1

      rem = length % g
      [base + 1] * rem + [base] * (g - rem)
    end

    # Spec section 8 (fixed mode) / 19.6 (expandable mode), with the spec
    # 18.2 blocklist scan over the raw code.
    #
    # @param id [Integer] 0 <= id < capacity (fixed); any non-negative id
    #   whose code fits in 32 symbols (expandable)
    # @return [String] canonical code (grouped only when a separator applies)
    # @raise [BasehError] OUT_OF_RANGE, PERMUTATION_FAILURE, BLOCKED_CODE
    def encode(id:)
      unless id.is_a?(Integer)
        raise TypeError, "id must be an Integer"
      end
      return encode_expandable(id) if @profile.mode == "expandable"

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
      body_length =
        if @profile.mode == "expandable"
          raw.length - @profile.checksum_length
        else
          @profile.body_length
        end
      body = raw.slice(0, body_length)
      supplied_checksum = raw.slice(body_length..) || ""

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
        # Spec 10: replacements that are not body alphabet symbols are
        # dropped before candidate generation. A suggested symbol the alphabet
        # cannot contain (say a spoken drop on a stripped-alphabet profile)
        # could never validate; generating it anyway would throw
        # INVALID_CHARACTER from the checksum step instead of reporting an
        # honest INVALID_CHECKSUM.
        map = confusion_map(confusion_profile)
        filtered = {}
        map.each do |source, replacements|
          kept = replacements.select { |r| @body_index.key?(r) }
          filtered[source] = kept unless kept.empty?
        end
        valid = {}
        generate_candidates(body, filtered, max_corrections).each do |candidate|
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
      if @profile.mode == "expandable"
        # Spec 19.7: the offset is de-permuted within the generation's own
        # domain (length mixed into the key derivation), then the generation
        # base is added back.
        l = raw.length
        if perm[:enabled]
          value = Feistel.inverse_permute(
            value, generation_capacity(l),
            profile_id: @profile.profile_id,
            key_bytes: perm[:key_bytes],
            rounds: perm[:rounds],
            length: l
          )
        end
        value = generation_base(l) + value
      elsif perm[:enabled]
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

    # Spec 3.1 normalization, steps 1-9, with the spec 3.4 re-pad in fixed
    # mode only. Returns the raw unformatted string.
    def normalize(input, accept_spaces)
      s = input.gsub(ASCII_WS, "")
      had_separator = !@profile.separator.empty? && s.include?(@profile.separator)
      s = s.delete(@profile.separator) unless @profile.separator.empty?
      s = s.delete(" ") if accept_spaces
      s = s.upcase unless @profile.case_sensitive
      # Spec 3.2: an alias never maps two distinct canonical symbols into one
      # value, so a symbol that is already canonical stays as-is and only
      # non-canonical symbols are aliased. (In fixed tiers alias sources are
      # never canonical, so this changes nothing there.)
      s = s.each_char.map do |ch|
        if @body_index.key?(ch) || @profile.checksum_alphabet.include?(ch)
          ch
        else
          @profile.aliases.fetch(ch, ch)
        end
      end.join

      s.each_char do |ch|
        next if @body_index.key?(ch) || @profile.checksum_alphabet.include?(ch)

        raise BasehError.new(
          "INVALID_CHARACTER",
          "Symbol #{ch.inspect} is not accepted"
        )
      end

      if @profile.mode == "expandable"
        # Spec 19.2/19.7: no left-padding and no stripped-zero leniency. Input
        # shorter than minLength or longer than 32 fails INVALID_LENGTH, and a
        # separator below separatorMinLength is rejected (spec 19.5: the
        # decoder expects no separators there).
        if s.length < @profile.min_length
          raise BasehError.new(
            "INVALID_LENGTH",
            "Expected at least #{@profile.min_length} symbols, got #{s.length}"
          )
        end
        if s.length > 32
          raise BasehError.new(
            "INVALID_LENGTH",
            "Expected at most 32 symbols, got #{s.length}"
          )
        end
        if had_separator && s.length < @profile.separator_min_length
          raise BasehError.new(
            "INVALID_CHARACTER",
            "Separators do not appear below #{@profile.separator_min_length} symbols"
          )
        end
        return s
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
    # code, plus the spec 21.2 run scan. BLOCKED_CODE is an issuance
    # decision, not an end-user condition.
    def check_blocklist!(raw)
      unless @profile.blocklist.empty?
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
      # Spec 21.2: a run of the same symbol at or above maxRepetition blocks
      # the code. Runs are measured on the raw string, so a separator never
      # breaks a run.
      max = @profile.max_repetition
      return unless max.positive? && /(.)\1{#{max - 1},}/.match?(raw)

      raise BasehError.new(
        "BLOCKED_CODE",
        "The generated reference repeats a symbol beyond the profile limit",
        safe_for_customer: false
      )
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

    # Spec 19.6. The id selects its generation by magnitude; the offset
    # within the generation is permuted in that generation's own domain.
    def encode_expandable(id)
      if id.negative?
        raise BasehError.new("OUT_OF_RANGE", "ID #{id} is negative")
      end
      l = generation_for_id(id)
      if l > 32
        raise BasehError.new(
          "OUT_OF_RANGE",
          "ID #{id} requires a code longer than 32 symbols"
        )
      end
      value = id - generation_base(l)
      domain = generation_capacity(l)
      perm = @profile.permutation
      if perm[:enabled]
        value = Feistel.permute(
          value, domain,
          profile_id: @profile.profile_id,
          key_bytes: perm[:key_bytes],
          rounds: perm[:rounds],
          length: l
        )
      end
      body = BaseN.encode_base_n(value, @profile.body_alphabet, l - @profile.checksum_length)
      checksum = Checksum.calculate_checksum(@profile, body, @body_index)
      raw = body + checksum
      check_blocklist!(raw)
      format_raw(raw)
    end

    # Spec 11/19.5. In expandable mode the separator applies only at or above
    # separatorMinLength, with the balanced grouping derived from the total
    # length.
    def format_raw(raw)
      return raw if @profile.separator.empty?

      grouping =
        if @profile.mode == "expandable"
          return raw if raw.length < @profile.separator_min_length

          self.class.expandable_grouping(raw.length)
        else
          @profile.grouping
        end
      parts = []
      offset = 0
      grouping.each do |size|
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
