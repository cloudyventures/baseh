# frozen_string_literal: true

require "minitest/autorun"
require "baseh"

# Spec 12.5: live as-you-type inspection. Mirrors js/test/inspect.test.ts.
class TestInspect < Minitest::Test
  def medium
    @medium ||= Baseh::Baseh.new(Baseh.baseh_medium_v1) # fixed, expected 8, grouping [4, 4]
  end

  def expandable
    @expandable ||= Baseh::Baseh.new(Baseh.baseh_expandable_v1) # minLength 4, separatorMinLength 6
  end

  # A filter-free medium clone, like the JS tests use for scans.
  def medium_clone(**overrides)
    Baseh::Baseh.new(Baseh.baseh_medium_v1.merge(
      { profanity: { mode: "none" }, max_repetition: 0 }.merge(overrides)
    ))
  end

  # fixed mode (baseh-medium-v1)

  def test_empty_states
    assert_equal "empty", medium.inspect("").state
    assert_equal "empty", medium.inspect("   ").state
    assert_equal "empty", medium.inspect(" - \t").state
  end

  def test_typing_prefixes_carry_normalized_symbols_and_progress
    raw = medium.encode(id: 123_456_789).delete("-")
    (1...8).each do |n|
      r = medium.inspect(raw.slice(0, n))
      assert_equal "typing", r.state, "prefix #{n}"
      assert_equal raw.slice(0, n), r.typed.delete("-")
      assert_in_delta n / 8.0, r.progress, 1e-9
    end
    # separators inserted as far as the groups go (grouping [4, 4])
    r5 = medium.inspect(raw.slice(0, 5))
    assert_equal "typing", r5.state
    assert_equal "#{raw.slice(0, 4)}-#{raw.slice(4, 1)}", r5.typed
  end

  def test_typing_lowercase_and_aliases_normalize_while_typing
    raw = medium.encode(id: 123_456_789).delete("-")
    lower = medium.inspect(raw.slice(0, 5).downcase)
    assert_equal "typing", lower.state
    assert_equal "#{raw.slice(0, 4)}-#{raw[4]}", lower.typed
    # alias source typed mid-code normalizes to its target (O -> 0 etc.)
    aliased = medium_clone(permutation: { enabled: false }).inspect("OIL")
    assert_equal "typing", aliased.state
    assert_equal "011", aliased.typed
  end

  def test_typing_whitespace_and_stray_separators_are_ignored_for_counting
    raw = medium.encode(id: 123_456_789).delete("-")
    messy = " #{raw.slice(0, 2)} -#{raw.slice(2, 3)}\t"
    r = medium.inspect(messy)
    assert_equal "typing", r.state
    assert_equal raw.slice(0, 5), r.typed.delete("-")
  end

  def test_padded_prefix_that_passes_the_checksum_still_reports_typing
    # Spec 3.4: find a short input whose re-padded form validates (the
    # cookbook's "false green"), on a filter-free clone so the scan is not
    # disturbed by the blocklist or repetition filter.
    clone = medium_clone
    found = nil
    (0...200_000).each do |id|
      raw = clone.encode(id: id).delete("-")
      stripped = raw.sub(/^0+(?=.)/, "")
      if stripped.length < raw.length && stripped.length >= 2 && clone.validate(stripped).valid
        found = stripped
        break
      end
    end
    refute_nil found, "no false-green prefix found in scan window"
    assert_equal "typing", medium.inspect(found).state
  end

  def test_valid_complete_code_with_id_and_canonical_code
    canonical = medium.encode(id: 123_456_789)
    r = medium.inspect(canonical)
    assert_equal "valid", r.state
    assert_equal 123_456_789, r.id
    assert_equal canonical, r.canonical_code
    # no separators, lowercase, surrounding whitespace all reach valid
    r2 = medium.inspect(" #{canonical.delete('-').downcase} ")
    assert_equal "valid", r2.state
    assert_equal 123_456_789, r2.id
    assert_equal canonical, r2.canonical_code
  end

  def test_valid_alias_typed_complete_code_decodes
    clone = medium_clone
    # find a code containing 8, type it with B (B -> 8)
    (1...100_000).each do |id|
      raw = clone.encode(id: id).delete("-")
      next unless raw.include?("8")

      r = clone.inspect(raw.sub("8", "B"))
      assert_equal "valid", r.state
      assert_equal id, r.id
      return
    end
    flunk "no code containing 8 found"
  end

  def test_invalid_complete_code_with_wrong_checksum_carries_the_reason
    raw = medium.encode(id: 77).delete("-")
    bad_check = raw[6] == "2" ? "3" : "2"
    bad = raw.slice(0, 6) + bad_check + raw[7]
    r = medium.inspect(bad)
    assert_equal "invalid", r.state
    assert_equal "INVALID_CHECKSUM", r.reason
  end

  def test_bad_char_symbol_outside_both_alphabets
    assert_equal "bad-char", medium.inspect("12@").state
    assert_equal "bad-char", medium.inspect("1234-56@8").state
  end

  def test_checksum_only_symbol_in_body_region_is_invalid_not_bad_char
    # U is in the Heavy checksum alphabet but not its body alphabet: it
    # passes the union-membership gate and fails under validate, exactly
    # like the shared error vector (heavy "U00000A" -> INVALID_CHARACTER).
    heavy = Baseh::Baseh.new(Baseh.baseh_heavy_v1)
    r = heavy.inspect("U000000A")
    assert_equal "invalid", r.state
    assert_equal "INVALID_CHARACTER", r.reason
  end

  def test_too_long_more_than_body_length_plus_checksum_length
    assert_equal "too-long", medium.inspect("00000000C").state
    assert_equal "too-long", medium.inspect("0000-0000-C").state
  end

  def test_no_checksum_fixed_profile_every_complete_length_validates
    minimum = Baseh::Baseh.new(Baseh.baseh_minimum_v1) # 6 symbols, no checksum
    canonical = minimum.encode(id: 42)
    assert_equal "valid", minimum.inspect(canonical).state
    assert_equal "typing", minimum.inspect(canonical.slice(0, 3)).state
  end

  # expandable mode (baseh-expandable-v1)

  def test_expandable_empty_and_below_min_length_typing
    assert_equal "empty", expandable.inspect("").state

    r = expandable.inspect("1")
    assert_equal "typing", r.state
    assert_equal "1", r.typed
    assert_in_delta 0.25, r.progress, 1e-9

    r = expandable.inspect("12")
    assert_equal "typing", r.state
    assert_equal "12", r.typed
    assert_in_delta 0.5, r.progress, 1e-9

    r = expandable.inspect("123")
    assert_equal "typing", r.state
    assert_equal "123", r.typed
    assert_in_delta 0.75, r.progress, 1e-9

    # below separatorMinLength the typing render is bare
    r = expandable.inspect("ab")
    assert_equal "typing", r.state
    assert_equal "AB", r.typed
    assert_in_delta 0.5, r.progress, 1e-9

    # aliases normalize while typing (O -> 0, a checksum-alphabet symbol)
    r = expandable.inspect("O")
    assert_equal "typing", r.state
    assert_equal "0", r.typed
    assert_in_delta 0.25, r.progress, 1e-9
  end

  def test_expandable_generation_boundaries_min_length_is_first_complete
    code4 = expandable.encode(id: 0) # first id, generation 4
    assert_equal 4, code4.length
    r = expandable.inspect(code4)
    assert_equal "valid", r.state
    assert_equal 0, r.id
    assert_equal code4, r.canonical_code

    code5 = expandable.encode(id: 39_304) # first id of generation 5
    assert_equal 5, code5.length
    r = expandable.inspect(code5)
    assert_equal "valid", r.state
    assert_equal 39_304, r.id
    assert_equal code5, r.canonical_code

    code6 = expandable.encode(id: 1_375_640) # generation 6, renders with a hyphen
    assert_equal 7, code6.length
    r = expandable.inspect(code6)
    assert_equal "valid", r.state
    assert_equal 1_375_640, r.id
    assert_equal code6, r.canonical_code
  end

  def test_expandable_bad_checksum_at_complete_length_is_invalid_not_typing
    sample = expandable.encode(id: 777).delete("-") # generation 4
    five = "#{sample}A" # wrong-length presentation, checksum fails (spec 19.7)
    r = expandable.inspect(five)
    assert_equal "invalid", r.state
    assert_equal "INVALID_CHECKSUM", r.reason
  end

  def test_expandable_zero_or_o_in_body_position_is_invalid_character
    sample = expandable.encode(id: 777).delete("-")
    ["0#{sample.slice(1..)}", "O#{sample.slice(1..)}"].each do |bad|
      r = expandable.inspect(bad)
      assert_equal "invalid", r.state
      assert_equal "INVALID_CHARACTER", r.reason
    end
  end

  def test_expandable_bad_char_and_too_long
    assert_equal "bad-char", expandable.inspect("A@").state
    assert_equal "bad-char", expandable.inspect("ABCD@").state
    assert_equal "too-long", expandable.inspect("A" * 33).state
    # 32 real symbols pass the length gate and land on validate
    assert_equal "invalid", expandable.inspect("A" * 32).state
  end

  def test_expandable_whitespace_and_separators_in_complete_code_reach_valid
    code6 = expandable.encode(id: 1_375_640)
    raw = code6.delete("-")
    r = expandable.inspect(" #{raw.slice(0, 3)} - #{raw.slice(3..)}")
    assert_equal "valid", r.state
    assert_equal 1_375_640, r.id
    assert_equal code6, r.canonical_code
  end

  # zero-config facade

  def test_facade_matches_a_default_profile_instance
    ["", "1", "AB@", "A" * 33, expandable.encode(id: 42)].each do |input|
      assert_equal expandable.inspect(input), Baseh.inspect(input)
    end
    assert_equal "valid", Baseh.inspect(expandable.encode(id: 42)).state
  end
end
