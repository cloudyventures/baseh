# frozen_string_literal: true

module BaseHuman
  # Profanity safety, spec section 18. Profiles gain an optional
  # profanity: { mode:, words:, extra_words: } object. It never changes
  # decode behavior for issued codes and never changes capacity accounting.
  module Profanity
    # Spec 18.2 default list. Deliberately small; applications extend it.
    DEFAULT_BLOCKLIST = %w[
      CRAP TWAT SHAG DAMN FCK FUC SHT CNT TWT DCK AZZ BCH
    ].freeze

    MODES = %w[none no-vowels blocklist].freeze
    WORD = /\A[A-Za-z]{2,32}\z/.freeze
    VOWELS = "AEIOU"

    module_function

    # Spec 18.1: vowels removed for no-vowels mode, applied after case
    # normalization.
    def strip_vowels(alphabet_norm)
      alphabet_norm.delete(VOWELS)
    end

    # Spec 18.2: replacement semantics, then augmentation, uppercased and
    # deduplicated. Raises BasehError INVALID_PROFILE for malformed entries.
    def effective_blocklist(profanity)
      base = profanity[:words] || DEFAULT_BLOCKLIST
      list = Array(base) + Array(profanity[:extra_words] || [])
      out = []
      list.each do |word|
        unless word.is_a?(String) && WORD.match?(word)
          raise BasehError.new(
            "INVALID_PROFILE",
            "Invalid BaseH profile: blocklist entries must be 2 through 32 ASCII letters",
            safe_for_customer: false
          )
        end
        upper = word.upcase
        out << upper unless out.include?(upper)
      end
      out
    end
  end
end
