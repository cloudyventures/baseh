# frozen_string_literal: true

require "minitest/autorun"
require "baseh"

# Zero-config facade over the frozen baseh-expandable-v1 profile: Baseh.encode
# and Baseh.decode share one lazily built codec instance.
class TestFacade < Minitest::Test
  def expandable
    @expandable ||= Baseh::Baseh.new(Baseh.baseh_expandable_v1)
  end

  def assert_baseh_error(code, &block)
    error = assert_raises(Baseh::BasehError, &block)
    assert_equal code, error.code
  end

  def test_encode_returns_a_string
    assert_instance_of String, Baseh.encode(0)
    assert_instance_of String, Baseh.encode(123_456)
  end

  def test_decode_encode_round_trip
    [0, 1, 42, 813, 1_156, 123_456, 1_000_000_000_000].each do |id|
      assert_equal id, Baseh.decode(Baseh.encode(id)).id
    end
  end

  def test_decode_returns_the_instance_decode_result
    result = Baseh.decode(Baseh.encode(123_456))
    assert_instance_of Baseh::Baseh::DecodeResult, result
    assert_equal 123_456, result.id
    assert_equal Baseh.encode(123_456), result.canonical_code
    assert_equal false, result.corrected
  end

  def test_facade_agrees_with_a_manual_default_profile_instance
    [0, 1, 123_456, 1_000_000_000_000].each do |id|
      assert_equal expandable.encode(id: id), Baseh.encode(id)
      assert_equal expandable.encode(id: id), Baseh.decode(Baseh.encode(id)).canonical_code
    end
  end

  def test_errors_surface_like_the_instance_api
    assert_baseh_error("OUT_OF_RANGE") { Baseh.encode(-1) }
    assert_baseh_error("INVALID_LENGTH") { Baseh.decode("AB") }
    assert_baseh_error("INVALID_CHARACTER") { Baseh.decode("!!!!") }
    assert_baseh_error("INVALID_CHECKSUM") { Baseh.decode("ZZZZ") }
  end

  def test_decode_passes_keyword_options_through
    code = Baseh.encode(123_456)
    assert_equal 123_456, Baseh.decode(" #{code} ", accept_spaces: true).id
  end
end
