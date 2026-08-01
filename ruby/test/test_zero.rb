# frozen_string_literal: true

require "minitest/autorun"
require "baseh"

# Zero-config pair over the frozen baseh-medium-v1 profile: no profile
# object and no key, just to_code and from_code.
class TestZero < Minitest::Test
  def medium
    @medium ||= Baseh::Baseh.new(Baseh.baseh_medium_v1)
  end

  def assert_baseh_error(code, &block)
    error = assert_raises(Baseh::BasehError, &block)
    assert_equal code, error.code
  end

  def test_matches_the_frozen_medium_profile_exactly
    assert_equal medium.encode(id: 0), Baseh.to_code(0)
    assert_equal medium.encode(id: 123_456_789), Baseh.to_code(123_456_789)
    assert_equal "H3C9-2PEM", Baseh.to_code(481_890_303)
    assert_equal "UJEA-4MA7", Baseh.to_code(0)
    assert_equal "C8XP-8J49", Baseh.to_code(123_456_789)
  end

  def test_to_code_accepts_integer_and_decimal_string
    assert_equal Baseh.to_code(123_456_789), Baseh.to_code("123456789")
  end

  def test_to_code_rejects_bad_input_with_argument_error
    assert_raises(ArgumentError) { Baseh.to_code("12x3") }
    assert_raises(ArgumentError) { Baseh.to_code("") }
    assert_raises(ArgumentError) { Baseh.to_code(nil) }
    assert_raises(ArgumentError) { Baseh.to_code(1.5) }
  end

  def test_to_code_raises_on_out_of_range_and_blocklisted_ids
    assert_baseh_error("OUT_OF_RANGE") { Baseh.to_code(481_890_304) }
    # 813 is reserved by the Medium blocklist once the frozen permutation is
    # applied.
    assert_baseh_error("BLOCKED_CODE") { Baseh.to_code(813) }
  end

  def test_from_code_returns_an_integer_and_round_trips
    id = Baseh.from_code(Baseh.to_code(123_456_789))
    assert_instance_of Integer, id
    assert_equal 123_456_789, id
  end

  def test_from_code_accepts_lowercase_aliases_and_any_whitespace
    code = Baseh.to_code(123_456_789)
    assert_equal 123_456_789, Baseh.from_code(code.downcase)
    spaced = "  #{code[0, 3]} #{code[3, 2]}\t#{code[5..]} "
    assert_equal 123_456_789, Baseh.from_code(spaced)
    # Typed aliases decode to canonical values: O reads as 0.
    assert_equal 1, Baseh.from_code("UORY-PDCA")
  end

  def test_from_code_raises_on_invalid_input_with_no_correction
    assert_baseh_error("INVALID_CHECKSUM") { Baseh.from_code("00000000") }
    assert_baseh_error("INVALID_CHARACTER") { Baseh.from_code("!!!!!!!!") }
    # B is an alias at Medium: it decodes as 8 rather than failing.
    code8 = nil
    id8 = nil
    (1..100_000).each do |i|
      begin
        code8 = Baseh.to_code(i)
      rescue Baseh::BasehError => e
        raise unless e.code == "BLOCKED_CODE"
        next
      end
      (id8 = i) && break if code8.include?("8")
    end
    assert id8, "expected a medium code containing 8"
    assert_equal id8, Baseh.from_code(code8.sub("8", "B"))
    assert_baseh_error("INVALID_LENGTH") { Baseh.from_code("") }
  end
end
