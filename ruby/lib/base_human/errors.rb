# frozen_string_literal: true

module BaseHuman
  # Error raised by every baseH failure path. #code is one of the spec error
  # codes (spec sections 12, 13 and 18).
  class BasehError < StandardError
    CODES = %w[
      INVALID_PROFILE
      OUT_OF_RANGE
      PERMUTATION_FAILURE
      INVALID_LENGTH
      INVALID_CHARACTER
      INVALID_CHECKSUM
      AMBIGUOUS_INPUT
      TOO_MANY_CANDIDATES
      BLOCKED_CODE
    ].freeze

    # @return [String] one of CODES
    attr_reader :code

    # @return [Boolean] true when the message may be shown to an end user
    attr_reader :safe_for_customer

    def initialize(code, message, safe_for_customer: true)
      raise ArgumentError, "unknown baseH error code #{code}" unless CODES.include?(code)

      super(message)
      @code = code
      @safe_for_customer = safe_for_customer
    end
  end
end
