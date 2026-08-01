# frozen_string_literal: true

require "minitest/autorun"
require "baseh"

# Expandable mode, spec section 19 and the frozen tier of section 17.1.
# Mirrors js/test/expandable.test.ts.
class TestExpandable < Minitest::Test
  TEST_KEY = "test-only-key-material-0001".b

  # A custom expandable profile with no permutation and no blocklist.
  def custom_expandable(**overrides)
    {
      profile_id: "custom-expandable-test",
      mode: "expandable",
      body_alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", # 0/O stripped at preparation
      min_length: 3,
      checksum_alphabet: "",
      checksum_length: 1,
      case_sensitive: false,
      separator: "",
      separator_min_length: 0,
      grouping: [],
      aliases: { "O" => "0", "I" => "1", "L" => "1" },
      permutation: { enabled: false }
    }.merge(overrides)
  end

  def expandable
    @expandable ||= Baseh::Baseh.new(Baseh.baseh_expandable_v1)
  end

  def raw(code)
    code.delete("-")
  end

  def assert_error(code)
    error = assert_raises(Baseh::BasehError) { yield }
    assert_equal code, error.code
  end

  # Spec 17.1/19.3: prepared alphabets and derived values.
  def test_frozen_tier_shape
    profile = expandable.profile
    assert_equal "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ", profile.body_alphabet
    assert_equal 34, profile.body_alphabet.length
    assert_equal "0123456789ABCDEFGHIJKLMNPQRSTUVWXYZ", profile.checksum_alphabet
    assert_equal 35, profile.checksum_alphabet.length
    assert_equal 1225, profile.checksum_modulus
    assert_equal "expandable", profile.mode
    assert_equal 4, profile.min_length
    assert_equal 6, profile.separator_min_length
  end

  # Spec 17.1 generation table.
  def test_generation_table
    expected = [
      [4, 0, 1_156],
      [5, 1_156, 39_304],
      [6, 40_460, 1_336_336],
      [7, 1_376_796, 45_435_424],
      [8, 46_812_220, 1_544_804_416]
    ]
    expected.each do |l, base, cap|
      assert_equal base, expandable.generation_base(l), "generationBase(#{l})"
      assert_equal cap, expandable.generation_capacity(l), "generationCapacity(#{l})"
    end
  end

  # Spec 12.3: capacity is fixed-mode only.
  def test_capacity_is_fixed_mode_only
    assert_error("INVALID_PROFILE") { expandable.capacity }
  end

  # Boundary round trips: last id of generation L, first id of L+1.
  def test_boundary_round_trips
    (4..8).each do |l|
      base = expandable.generation_base(l)
      nxt = expandable.generation_base(l + 1)
      [base, nxt - 1, nxt].each do |id|
        code = expandable.encode(id: id)
        assert_equal expandable.generation_for_id(id), raw(code).length
        result = expandable.decode(code)
        assert_equal id, result.id
        assert_equal code, result.canonical_code
        refute result.corrected
        # The zero ban makes a non-zero leading body symbol structural.
        refute_equal "0", raw(code)[0]
        refute_equal "O", raw(code)[0]
      end
    end
  end

  def test_last_four_character_and_first_five_character_ids
    assert_equal 4, raw(expandable.encode(id: 1_155)).length
    assert_equal 5, raw(expandable.encode(id: 1_156)).length
  end

  def test_exhaustive_round_trip_of_generation_4
    issued = 0
    1_156.times do |id|
      begin
        code = expandable.encode(id: id)
      rescue Baseh::BasehError => e
        assert_equal "BLOCKED_CODE", e.code
        next # blocklisted ids are reserved, never issued (spec 18)
      end
      assert_equal 4, raw(code).length
      assert_equal id, expandable.decode(code).id
      issued += 1
    end
    assert issued > 1_100, "expected nearly all 1156 ids issuable, got #{issued}"
  end

  def test_boundaries_on_a_custom_expandable_profile
    c = Baseh::Baseh.new(custom_expandable)
    # minLength 3, checksum 1, body 34: generation 3 holds 34^2 = 1156 ids.
    assert_equal 0, c.generation_base(3)
    assert_equal 1_156, c.generation_base(4)
    [0, 1, 1_155, 1_156, 40_459, 40_460].each do |id|
      assert_equal id, c.decode(c.encode(id: id)).id
    end
    assert_equal 3, c.encode(id: 1_155).length
    assert_equal 4, c.encode(id: 1_156).length
  end

  # Spec 19.2: presented 0 in a body position fails INVALID_CHARACTER.
  def test_zero_in_a_body_position_fails
    code = raw(expandable.encode(id: 1_000))
    assert_error("INVALID_CHARACTER") { expandable.decode("0#{code[1..]}") }
  end

  # Spec 19.2: a typed O aliases to 0 and fails the same way in a body slot.
  def test_typed_o_in_a_body_position_fails
    code = raw(expandable.encode(id: 1_000))
    assert_error("INVALID_CHARACTER") { expandable.decode("O#{code[1..]}") }
  end

  def test_custom_alphabet_with_zero_and_o_is_silently_stripped
    profile = Baseh::Baseh.new(custom_expandable).profile
    refute_includes profile.body_alphabet, "0"
    refute_includes profile.body_alphabet, "O"
    assert_equal "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ", profile.body_alphabet
  end

  def test_body_alphabet_must_keep_two_symbols
    assert_error("INVALID_PROFILE") do
      Baseh::Baseh.new(custom_expandable(body_alphabet: "0O"))
    end
  end

  # Spec 19.3: checksums containing 0 encode, decode and round-trip.
  def test_checksum_containing_zero_round_trips
    found = []
    id = 0
    while id < 200_000 && found.length < 8
      begin
        code = expandable.encode(id: id)
        found << [id, code] if raw(code)[-2..].include?("0")
      rescue Baseh::BasehError
        # blocklisted ids are never issued
      end
      id += 1
    end
    assert found.length >= 8, "expected checksum-with-zero codes in the sample"
    found.each do |found_id, code|
      result = expandable.decode(code)
      assert_equal found_id, result.id
      assert_equal code, result.canonical_code
    end
  end

  # A typed O in a checksum position aliases to 0 and is not a correction
  # (spec 9: canonicalize applies aliases before the comparison).
  def test_typed_o_in_checksum_position_decodes_to_same_id
    pinned = nil
    id = 0
    while id < 500_000 && pinned.nil?
      begin
        code = expandable.encode(id: id)
        pinned = [id, code] if raw(code).end_with?("0")
      rescue Baseh::BasehError
        # blocklisted ids are never issued
      end
      id += 1
    end
    refute_nil pinned, "expected a code whose checksum ends in 0"
    id, code = pinned
    typed = "#{raw(code)[0...-1]}O"
    result = expandable.decode(typed)
    assert_equal id, result.id
    assert_equal code, result.canonical_code
    refute result.corrected
  end

  # M = 1225 > 33 and gcd(36, 1225) = 1, so detection is provably total
  # (spec 17.1); the sweep pins it at generations 4, 6 and 8.
  def test_detects_single_substitutions_and_transpositions
    alphabet = expandable.profile.body_alphabet
    index = Baseh::BaseN.alphabet_index(alphabet)
    [4, 6, 8].each do |l|
      body_len = l - expandable.profile.checksum_length
      misses = 0
      expandable.generation_base(l).upto(expandable.generation_base(l) + 49) do |id|
        begin
          code = expandable.encode(id: id)
        rescue Baseh::BasehError
          next
        end
        body = raw(code)[0...body_len]
        before = Baseh::Checksum.checksum_value(expandable.profile, body, index)
        body_len.times do |pos|
          cur = index[body[pos]]
          [1, 5, 17].each do |delta|
            nv = (cur + delta) % 34
            candidate = body[0...pos] + alphabet[nv] + body[(pos + 1)..]
            misses += 1 if Baseh::Checksum.checksum_value(expandable.profile, candidate, index) == before
          end
        end
        (body_len - 1).times do |pos|
          next if body[pos] == body[pos + 1]

          swapped = body[0...pos] + body[pos + 1] + body[pos] + body[(pos + 2)..]
          misses += 1 if Baseh::Checksum.checksum_value(expandable.profile, swapped, index) == before
        end
      end
      assert_equal 0, misses, "generation #{l} had #{misses} checksum misses"
    end
  end

  # Spec 19.2: no left-padding, no stripped-zero leniency.
  def test_input_shorter_than_min_length_fails
    assert_error("INVALID_LENGTH") { expandable.decode("1") }
    assert_error("INVALID_LENGTH") { expandable.decode("ABC") }
    assert_error("INVALID_LENGTH") { expandable.decode("") }
  end

  def test_input_longer_than_32_symbols_fails
    assert_error("INVALID_LENGTH") { expandable.decode("A" * 33) }
  end

  def test_canonical_code_always_has_the_presented_length
    [0, 1_155, 1_156, 40_460, 123_456_789].each do |id|
      code = expandable.encode(id: id)
      assert_equal raw(code).length, raw(expandable.decode(code).canonical_code).length
    end
  end

  # Spec 19.5: lengths 4 and 5 render bare.
  def test_lengths_4_and_5_render_bare
    refute_includes expandable.encode(id: 0), "-"
    refute_includes expandable.encode(id: 1_156), "-"
  end

  def test_decoder_rejects_a_separator_below_separator_min_length
    code = expandable.encode(id: 0)
    assert_error("INVALID_CHARACTER") { expandable.decode("#{code[0...2]}-#{code[2..]}") }
  end

  def test_separator_shapes_for_lengths_6_through_10
    shapes = {
      6 => /\A..-....\z/,
      7 => /\A...-....\z/,
      8 => /\A....-....\z/,
      9 => /\A.-....-....\z/,
      10 => /\A..-....-....\z/
    }
    shapes.each do |length, shape|
      base = expandable.generation_base(length)
      code = nil
      base.upto(base + 4_999) do |probe|
        begin
          code = expandable.encode(id: probe)
          break
        rescue Baseh::BasehError
          next
        end
      end
      refute_nil code, "no issuable id found at generation #{length}"
      assert_match shape, code, "generation #{length}: #{code}"
      assert_equal code, expandable.decode(code).canonical_code
    end
  end

  def test_expandable_grouping_consumes_the_pattern_right_anchored
    group = ->(length, pattern) { Baseh::Baseh.expandable_grouping(length, pattern) }
    assert_equal [2, 4], group.call(6, [4, 4])
    assert_equal [3, 4], group.call(7, [4, 4])
    assert_equal [4, 4], group.call(8, [4, 4])
    assert_equal [1, 4, 4], group.call(9, [4, 4])
    assert_equal [2, 4, 4], group.call(10, [4, 4])
    assert_equal [4, 4, 4], group.call(12, [4, 4])
    assert_equal [2, 2, 3], group.call(7, [2, 3])
  end

  # Spec 19.7: a code presented at the wrong length can never alias a valid
  # shorter code.
  def test_appended_symbol_never_aliases_the_shorter_id
    id = 777
    code = raw(expandable.encode(id: id))
    assert_equal 4, code.length
    %w[1 A Z].each do |extra|
      longer = code + extra # 5 symbols: body split moves, checksum fails
      result = expandable.validate(longer)
      refute result.valid
      assert_includes %w[INVALID_CHECKSUM INVALID_CHARACTER], result.reason
      assert_error(result.reason) { expandable.decode(longer) }
    end
  end

  def test_removed_symbol_fails
    code = raw(expandable.encode(id: 40_460)) # generation 6
    refute expandable.validate(code[1..]).valid
  end

  def test_correction_never_crosses_generations
    code = expandable.encode(id: 123_456_789) # generation 8
    r = raw(code)
    pairs = { "B" => "D", "D" => "B", "P" => "T", "T" => "P",
              "M" => "N", "N" => "M", "V" => "W", "W" => "V" }
    typo = nil
    (r.length - 2).times do |pos|
      replacement = pairs[r[pos]]
      next unless replacement

      typo = r[0...pos] + replacement + r[(pos + 1)..]
      break
    end
    refute_nil typo, "expected a confusable body symbol in the sample code"
    result = expandable.decode(typo, try_correction: true, confusion_profile: :medium)
    assert_equal r.length, raw(result.canonical_code).length
    assert_equal 123_456_789, result.id
  end

  # The keyed -p tier round trips across generations with caller key material.
  def test_keyed_p_tier_round_trips
    p = Baseh::Baseh.new(Baseh.baseh_expandable_p_v1(key_bytes: TEST_KEY, key_id: "test-01"))
    assert_equal "baseh-expandable-p-v1", p.profile.profile_id
    [0, 1, 1_155, 1_156, 40_460, 123_456_789, p.generation_base(9)].each do |id|
      begin
        code = p.encode(id: id)
      rescue Baseh::BasehError => e
        assert_equal "BLOCKED_CODE", e.code
        next
      end
      assert_equal id, p.decode(code).id
    end
  end

  def test_keyed_p_tier_honours_custom_rounds
    p4 = Baseh::Baseh.new(Baseh.baseh_expandable_p_v1(key_bytes: TEST_KEY, key_id: "test-01", rounds: 4))
    p8 = Baseh::Baseh.new(Baseh.baseh_expandable_p_v1(key_bytes: TEST_KEY, key_id: "test-01", rounds: 8))
    c4 = p4.encode(id: 42)
    assert_equal 42, p4.decode(c4).id
    refute_equal c4, p8.encode(id: 42)
  end

  def test_keyed_variant_differs_from_the_frozen_key_tier
    keyed = Baseh::Baseh.new(Baseh.baseh_expandable_p_v1(key_bytes: TEST_KEY, key_id: "test-01"))
    refute_equal expandable.encode(id: 42), keyed.encode(id: 42)
  end

  # Spec 19.9: an explicit fixed mode behaves identically to an omitted one.
  def test_explicit_fixed_mode_matches_omitted_mode
    explicit = Baseh::Baseh.new(Baseh.baseh_medium_v1.merge(mode: "fixed"))
    implicit = Baseh::Baseh.new(Baseh.baseh_medium_v1)
    [0, 1, 813, 123_456_789, 481_890_303].each do |id|
      e = (explicit.encode(id: id) rescue nil)
      i = (implicit.encode(id: id) rescue nil)
      next if e.nil? && i.nil? # blocklisted in both

      assert_equal e, i
      assert_equal explicit.decode(e).id, implicit.decode(e).id unless e.nil?
    end
  end

  # A 4-character code presented to a fixed tier fails exactly as before:
  # re-padded per spec 3.4, then checksum failure.
  def test_short_code_on_a_fixed_tier_behaves_as_before
    result = Baseh::Baseh.new(Baseh.baseh_medium_v1).validate("ABCD")
    refute result.valid
    assert_equal "INVALID_CHECKSUM", result.reason
  end

  # The decoder must not guess mode from input: an expandable profile rejects
  # a fixed-tier 8-symbol code on the checksum, per spec 19.7.
  def test_expandable_does_not_sniff_fixed_codes
    fixed_code = Baseh::Baseh.new(Baseh.baseh_medium_v1).encode(id: 123_456_789)
    refute expandable.validate(fixed_code).valid
  end

  def test_grouping_validation_is_mode_conditional
    # [4, 4] does not sum to every expandable length and must validate.
    Baseh::Baseh.new(Baseh.baseh_expandable_v1)
    # Fixed mode still requires the sum.
    assert_error("INVALID_PROFILE") do
      Baseh::Baseh.new(Baseh.baseh_medium_v1.merge(grouping: [3, 3]))
    end
    # separatorMinLength is expandable-only.
    assert_error("INVALID_PROFILE") do
      Baseh::Baseh.new(Baseh.baseh_medium_v1.merge(separator_min_length: 6))
    end
    # minLength must exceed checksumLength.
    assert_error("INVALID_PROFILE") do
      Baseh::Baseh.new(custom_expandable(min_length: 1))
    end
  end
end
