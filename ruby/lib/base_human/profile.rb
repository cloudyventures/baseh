# frozen_string_literal: true

module BaseHuman
  # Profile validation and derived values, spec section 2.2.
  # Validation runs once at construction, never per encode/decode.
  #
  # Profiles are plain hashes with symbol keys:
  #   profile_id:, body_alphabet:, body_length:, checksum_alphabet:,
  #   checksum_length:, case_sensitive:, separator:, grouping:, aliases:,
  #   permutation: { enabled: true, algorithm: "feistel-v1", key_id:,
  #                  key_bytes:, rounds: } or { enabled: false },
  #   profanity: { mode: "none" | "no-vowels" | "blocklist",
  #                words: [...], extra_words: [...] } (optional, spec 18)
  module Profile
    ASCII_ONLY = /\A[\x20-\x7e]*\z/.freeze

    # Immutable, fully validated profile with pre-computed derived values.
    class Prepared
      attr_reader :profile_id, :body_alphabet, :body_length,
                  :checksum_alphabet, :checksum_length, :case_sensitive,
                  :separator, :grouping, :aliases, :permutation,
                  :capacity, :checksum_modulus, :profanity_mode, :blocklist

      def initialize(profile)
        validate_type!(profile)
        @profile_id = validate_profile_id!(profile[:profile_id])
        @case_sensitive = profile[:case_sensitive] == true

        @body_alphabet = validate_body_alphabet!(profile[:body_alphabet])
        @body_length = validate_integer!(profile[:body_length], 1, 32, "bodyLength")
        @checksum_length = validate_integer!(profile[:checksum_length], 0, 8, "checksumLength")
        @checksum_alphabet = validate_checksum_alphabet!(
          profile[:checksum_alphabet], @checksum_length
        )

        # Spec 18: validation happens before the vowel strip so malformed
        # alphabets are reported as such, then no-vowels strips and
        # re-validates the result.
        @profanity_mode = validate_profanity_mode!(profile[:profanity])
        if @profanity_mode == "no-vowels"
          @body_alphabet = Profanity.strip_vowels(@body_alphabet)
          @checksum_alphabet = Profanity.strip_vowels(@checksum_alphabet)
          validate_stripped!(@body_alphabet, "body")
          validate_stripped!(@checksum_alphabet, "checksum") if @checksum_length.positive?
          @body_alphabet.freeze
          @checksum_alphabet.freeze
        end
        @blocklist =
          if @profanity_mode == "blocklist"
            Profanity.effective_blocklist(profile[:profanity]).freeze
          else
            [].freeze
          end

        @separator = validate_separator!(
          profile[:separator].to_s, @body_alphabet, @checksum_alphabet
        )
        @aliases = validate_aliases!(
          profile[:aliases] || {}, @body_alphabet, @checksum_alphabet, @case_sensitive
        )
        @grouping = validate_grouping!(
          profile[:grouping], @separator, @body_length, @checksum_length
        )
        @permutation = validate_permutation!(profile[:permutation] || { enabled: false })

        @capacity = @body_alphabet.length**@body_length
        @checksum_modulus = [@checksum_alphabet.length, 1].max**@checksum_length
        freeze
      end

      private

      def self.fail_profile!(reason)
        raise BasehError.new("INVALID_PROFILE", "Invalid BaseH profile: #{reason}", safe_for_customer: false)
      end

      def ascii_char?(ch)
        ch.is_a?(String) && ch.length == 1 && ASCII_ONLY.match?(ch)
      end

      def validate_type!(profile)
        self.class.fail_profile!("profile is required") unless profile.is_a?(Hash)
      end

      def validate_profile_id!(value)
        unless value.is_a?(String) && !value.empty?
          self.class.fail_profile!("profileId must be non-empty")
        end
        unless ASCII_ONLY.match?(value)
          self.class.fail_profile!("profileId must be ASCII")
        end
        value
      end

      def validate_alphabet_symbols!(alphabet, label)
        alphabet.each_char do |ch|
          next if ascii_char?(ch)

          self.class.fail_profile!("#{label} symbol is not single ASCII: #{ch.inspect}")
        end
      end

      def norm_string(str)
        @case_sensitive ? str : str.upcase
      end

      def validate_body_alphabet!(alphabet)
        unless alphabet.is_a?(String) && alphabet.length >= 2
          self.class.fail_profile!("bodyAlphabet needs at least two symbols")
        end
        validate_alphabet_symbols!(alphabet, "body alphabet")
        normed = norm_string(alphabet)
        unless normed.each_char.uniq.length == normed.length
          self.class.fail_profile!("body alphabet symbols must be unique after case normalization")
        end
        normed.freeze
      end

      def validate_integer!(value, min, max, label)
        unless value.is_a?(Integer) && value >= min && value <= max
          self.class.fail_profile!("#{label} must be an integer from #{min} through #{max}")
        end
        value
      end

      def validate_checksum_alphabet!(alphabet, checksum_length)
        alphabet = alphabet.to_s
        if checksum_length.positive?
          unless alphabet.is_a?(String) && alphabet.length >= 2
            self.class.fail_profile!(
              "checksumAlphabet needs at least two symbols when checksumLength is positive"
            )
          end
          validate_alphabet_symbols!(alphabet, "checksum alphabet")
        end
        normed = norm_string(alphabet)
        unless normed.each_char.uniq.length == normed.length
          self.class.fail_profile!(
            "checksum alphabet symbols must be unique after case normalization"
          )
        end
        normed.freeze
      end

      def validate_profanity_mode!(profanity)
        mode = "none"
        if profanity.is_a?(Hash)
          mode = profanity[:mode].to_s
        elsif !profanity.nil?
          self.class.fail_profile!("profanity must be a mapping")
        end
        unless Profanity::MODES.include?(mode)
          self.class.fail_profile!("profanity mode must be none, no-vowels or blocklist")
        end
        mode
      end

      def validate_stripped!(alphabet, label)
        return if alphabet.length >= 2

        self.class.fail_profile!(
          "no-vowels mode leaves the #{label} alphabet with fewer than two symbols"
        )
      end

      def validate_separator!(separator, body_norm, checksum_norm)
        separator.each_char do |ch|
          next unless body_norm.include?(ch) || checksum_norm.include?(ch)

          self.class.fail_profile!("separator must not occur in either alphabet")
        end
        separator.freeze
      end

      def validate_aliases!(aliases, body_norm, checksum_norm, case_sensitive)
        unless aliases.is_a?(Hash)
          self.class.fail_profile!("aliases must be a mapping")
        end
        canonical = (body_norm + checksum_norm).each_char.to_a.to_set
        result = {}
        aliases.each do |src, tgt|
          src = src.to_s
          tgt = tgt.to_s
          unless ascii_char?(src)
            self.class.fail_profile!("alias source is not single ASCII: #{src.inspect}")
          end
          unless ascii_char?(tgt)
            self.class.fail_profile!("alias target is not single ASCII: #{tgt.inspect}")
          end
          s_norm = case_sensitive ? src : src.upcase
          t_norm = case_sensitive ? tgt : tgt.upcase
          if canonical.include?(s_norm)
            self.class.fail_profile!("alias source #{src.inspect} is already a canonical symbol")
          end
          unless canonical.include?(t_norm)
            self.class.fail_profile!("alias target #{tgt.inspect} is not a canonical symbol")
          end
          if result.key?(s_norm)
            self.class.fail_profile!("duplicate alias source #{s_norm.inspect} after case normalization")
          end
          # Alias chains (and therefore cycles) are forbidden: a target may
          # never itself be an alias source.
          chain = result.key?(t_norm) ||
                  aliases.keys.any? { |k| (case_sensitive ? k.to_s : k.to_s.upcase) == t_norm }
          if chain
            self.class.fail_profile!("alias chain forbidden: target #{t_norm} is also an alias source")
          end
          result[s_norm] = t_norm
        end
        result.freeze
      end

      def validate_grouping!(grouping, separator, body_length, checksum_length)
        unless grouping.is_a?(Array)
          self.class.fail_profile!("group sizes must be positive integers")
        end
        if separator.empty?
          unless grouping.empty?
            self.class.fail_profile!("grouping must be empty when separator is empty")
          end
        else
          unless grouping.all? { |g| g.is_a?(Integer) && g >= 1 }
            self.class.fail_profile!("group sizes must be positive integers")
          end
          unless grouping.sum == body_length + checksum_length
            self.class.fail_profile!("group sizes must sum to bodyLength + checksumLength")
          end
        end
        grouping.dup.freeze
      end

      def validate_permutation!(permutation)
        unless permutation.is_a?(Hash)
          self.class.fail_profile!("permutation must be a mapping")
        end
        return { enabled: false }.freeze unless permutation[:enabled] == true

        if permutation[:algorithm] != "feistel-v1"
          self.class.fail_profile!("unknown permutation algorithm")
        end
        key_id = permutation[:key_id]
        unless key_id.is_a?(String) && !key_id.empty?
          self.class.fail_profile!("permutation requires a keyId")
        end
        key_bytes = permutation[:key_bytes]
        unless key_bytes.is_a?(String) && !key_bytes.empty?
          self.class.fail_profile!("permutation requires key material")
        end
        rounds = permutation[:rounds]
        unless rounds.is_a?(Integer) && rounds >= 4 && rounds <= 16 && rounds.even?
          self.class.fail_profile!("Feistel rounds must be an even integer from 4 through 16")
        end
        {
          enabled: true,
          algorithm: "feistel-v1",
          key_id: key_id.dup.freeze,
          key_bytes: key_bytes.dup.force_encoding(Encoding::BINARY).freeze,
          rounds: rounds
        }.freeze
      end
    end

    # Validates a profile hash and returns a Prepared instance.
    # Raises BasehError with code INVALID_PROFILE on any violation.
    def self.prepare(profile)
      Prepared.new(profile)
    end
  end
end
