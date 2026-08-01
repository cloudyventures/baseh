# frozen_string_literal: true

require "minitest/autorun"
require "base_human"

# Zero-config pair over the frozen baseh-medium-v1 profile: no profile
# object and no key, just to_code and from_code.
class TestZero < Minitest::Test
  def medium
    @medium ||= BaseHuman::Baseh.new(BaseHuman.baseh_medium_v1)
  end

  def assert_baseh_error(code, &block)
    error = assert_raises(BaseHuman::BasehError, &block)
    assert_equal code, error.code
  end

  def test_matches_the_frozen_medium_profile_exactly
    assert_equal medium.encode(id: 0), BaseHuman.to_code(0)
    assert_equal medium.encode(id: 123_456_789), BaseHuman.to_code(123_456_789)
    assert_equal "ZZZZZZV", BaseHuman.to_code(481_890_303)
    assert_equal "000000C", BaseHuman.to_code(0)
  end

  def test_to_code_accepts_integer_and_decimal_string
    assert_equal BaseHuman.to_code(123_456_789), BaseHuman.to_code("123456789")
  end

  def test_to_code_rejects_bad_input_with_argument_error
    assert_raises(ArgumentError) { BaseHuman.to_code("12x3") }
    assert_raises(ArgumentError) { BaseHuman.to_code("") }
    assert_raises(ArgumentError) { BaseHuman.to_code(nil) }
    assert_raises(ArgumentError) { BaseHuman.to_code(1.5) }
  end

  def test_to_code_raises_on_out_of_range_and_blocklisted_ids
    assert_baseh_error("OUT_OF_RANGE") { BaseHuman.to_code(481_890_304) }
    # 1131 is reserved by the Medium blocklist.
    assert_baseh_error("BLOCKED_CODE") { BaseHuman.to_code(1131) }
  end

  def test_from_code_returns_an_integer_and_round_trips
    id = BaseHuman.from_code(BaseHuman.to_code(123_456_789))
    assert_instance_of Integer, id
    assert_equal 123_456_789, id
  end

  def test_from_code_accepts_lowercase_aliases_and_any_whitespace
    code = BaseHuman.to_code(123_456_789)
    assert_equal 123_456_789, BaseHuman.from_code(code.downcase)
    spaced = "  #{code[0, 3]} #{code[3, 2]}\t#{code[5..]} "
    assert_equal 123_456_789, BaseHuman.from_code(spaced)
    # Typed aliases decode to canonical values.
    assert_equal 0, BaseHuman.from_code("OOOOOOC")
  end

  def test_from_code_raises_on_invalid_input_with_no_correction
    assert_baseh_error("INVALID_CHECKSUM") { BaseHuman.from_code("0000000") }
    assert_baseh_error("INVALID_CHARACTER") { BaseHuman.from_code("!!!!!!!") }
    # B is not canonical in Medium and is not an alias; no correction guesses it.
    assert_baseh_error("INVALID_CHARACTER") { BaseHuman.from_code("B00000C") }
    assert_baseh_error("INVALID_LENGTH") { BaseHuman.from_code("") }
  end
end
