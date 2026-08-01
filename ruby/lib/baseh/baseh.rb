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

    # Result of inspect (spec 12.5). #state is one of "empty", "typing",
    # "bad-char", "too-long", "invalid", "valid". Payload fields are present
    # exactly when the state carries them: #typed and #progress for "typing",
    # #reason for "invalid", #id and #canonical_code for "valid".
    InspectResult = Struct.new(:state, :typed, :progress, :reason, :id, :canonical_code,
                               keyword_init: true)

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

    # Spec 19.1/22.3. First id of generation length: the sum of each
    # generation's capacity A^(k - effectiveK(k)) for k from minLength
    # through length-1. The effective checksum length is per-generation
    # (spec 22), so the sum is not a single geometric series when the short
    # checksum is on.
    def generation_base(length)
      base = 0
      @profile.min_length.upto(length - 1) do |l|
        base += generation_capacity(l)
      end
      base
    end

    # Spec 19.1/22.3. Ids held by generation length: A^(length - effectiveK).
    def generation_capacity(length)
      @profile.body_alphabet.length**(length - @profile.effective_checksum_length(length))
    end

    # Smallest generation whose range holds id, per spec 19.6. The loop is
    # capped at the 32-symbol code limit (33 - minLength iterations) so an
    # adversarial id fails fast with OUT_OF_RANGE instead of running big-integer
    # multiplication on exponentially growing values.
    def generation_for_id(id)
      l = @profile.min_length
      base = 0
      cap = generation_capacity(l)
      while id >= base + cap
        if l >= 32
          raise BasehError.new(
            "OUT_OF_RANGE",
            "ID requires a code longer than 32 symbols"
          )
        end
        base += cap
        l += 1
        cap = generation_capacity(l)
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
      # Spec 22: the generation is selected by the presented total length,
      # so the effective checksum length is a deterministic function of it.
      effective_k =
        if @profile.mode == "expandable"
          @profile.effective_checksum_length(raw.length)
        else
          @profile.checksum_length
        end
      body_length =
        if @profile.mode == "expandable"
          raw.length - effective_k
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

      if Checksum.calculate_checksum(@profile, body, @body_index, effective_k) != supplied_checksum
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
          if Checksum.calculate_checksum(@profile, candidate, @body_index, effective_k) == supplied_checksum
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

    # Spec 12.5. Live as-you-type inspection. Gates on the typed length before
    # validating, so the spec 3.4 re-pad can never paint an incomplete
    # fixed-mode code "valid" (or "invalid"): a short fixed input is "typing",
    # never checked. Never raises on user input and never reports "valid" for
    # an incomplete code.
    def inspect(input)
      p = @profile
      # Step 1: remove every occurrence of the separator string, then drop
      # ASCII whitespace anywhere (a paste can carry either inside the code).
      s = p.separator.empty? ? input.dup : input.gsub(p.separator, "")
      s = s.delete("\t\n\v\f\r ")
      typed = s.length
      # Step 2.
      return InspectResult.new(state: "empty") if typed.zero?

      # Step 3. Fixed: complete exactly at bodyLength + checksumLength.
      # Expandable: complete at every length from minLength through 32 (the
      # length selects the generation), 32 is the over-length bound.
      fixed = p.mode == "fixed"
      expected = fixed ? p.body_length + p.checksum_length : 32
      return InspectResult.new(state: "too-long") if typed > expected

      # Step 4: spec 3.1 steps 4-6 without the length checks — case
      # normalization, aliases, then union membership. A symbol outside both
      # alphabets is "bad-char"; a symbol valid only in the other region (say
      # a checksum-only symbol typed into the body) passes here and fails
      # later under validate as INVALID_CHARACTER.
      s = s.upcase unless p.case_sensitive
      raw = s.each_char.map do |ch|
        inspect_union?(ch) ? ch : p.aliases.fetch(ch, ch)
      end.join
      return InspectResult.new(state: "bad-char") if raw.each_char.any? { |ch| !inspect_union?(ch) }

      # Step 5.
      complete = fixed ? typed == expected : typed >= p.min_length
      unless complete
        return InspectResult.new(
          state: "typing",
          typed: format_partial(raw),
          progress: typed.to_f / (fixed ? expected : p.min_length)
        )
      end

      # Step 6: judge the normalized string (no separator, no whitespace,
      # case- and alias-normalized).
      result = validate(raw)
      return InspectResult.new(state: "invalid", reason: result.reason) unless result.valid

      decoded = decode(raw)
      InspectResult.new(state: "valid", id: decoded.id, canonical_code: decoded.canonical_code)
    end

    # Spec 3.1 normalization, steps 1-9, with the spec 3.4 re-pad in fixed
    # mode only. Returns the raw unformatted string.
    def normalize(input, accept_spaces)
      s = input.gsub(ASCII_WS, "")
      had_separator = !@profile.separator.empty? && s.include?(@profile.separator)
      # Literal-substring removal (gsub with a string pattern), matching the
      # JS split-join reference: String#delete would treat the separator as a
      # character class and corrupt multi-character separators like "..".
      s = s.gsub(@profile.separator, "") unless @profile.separator.empty?
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
      value = id - generation_base(l)
      domain = generation_capacity(l)
      perm = @profile.permutation
      effective_k = @profile.effective_checksum_length(l)
      if perm[:enabled]
        value = Feistel.permute(
          value, domain,
          profile_id: @profile.profile_id,
          key_bytes: perm[:key_bytes],
          rounds: perm[:rounds],
          length: l
        )
      end
      body = BaseN.encode_base_n(value, @profile.body_alphabet, l - effective_k)
      checksum = Checksum.calculate_checksum(@profile, body, @body_index, effective_k)
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

    # Spec 12.5 step 4: membership in the union of the body and checksum
    # alphabets.
    def inspect_union?(ch)
      @body_index.key?(ch) || @profile.checksum_alphabet.include?(ch)
    end

    # Spec 12.5: separators inserted into a partially typed code, as far as
    # the groups go. Fixed mode walks the configured grouping, emitting no
    # separator for a group the symbols do not reach; expandable mode uses
    # the balanced grouping rule of spec 19.5 for the typed length, bare
    # below separatorMinLength.
    def format_partial(raw)
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
        break if offset >= raw.length

        parts << raw.slice(offset, size)
        offset += size
      end
      parts.join(@profile.separator)
    end

    def canonical_raw(canonical_code)
      return canonical_code if @profile.separator.empty?

      canonical_code.gsub(@profile.separator, "")
    end
  end
end
