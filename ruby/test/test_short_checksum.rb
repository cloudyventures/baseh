# frozen_string_literal: true

require "minitest/autorun"
require "baseh"

# Short checksum in expandable mode, spec section 22.
# Mirrors js/test/short-checksum.test.ts.
class TestShortChecksum < Minitest::Test
  TEST_KEY = "test-only-key-material-0001".b

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

  # Find the first issuable id at or after from.
  def first_issuable(codec, from)
    from.upto(from + 10_000) do |id|
      codec.encode(id: id)
      return id
    rescue Baseh::BasehError
      next
    end
    raise "no issuable id from #{from}"
  end

  # Spec 22.5: the frozen tiers ship the feature on.
  def test_frozen_tier_shape
    profile = expandable.profile
    assert_equal 2, profile.checksum_length
    assert_equal 1, profile.short_checksum_length
    assert_equal 5, profile.short_checksum_until
    p = Baseh::Baseh.new(Baseh.baseh_expandable_p_v1(key_bytes: TEST_KEY, key_id: "test-01"))
    assert_equal 1, p.profile.short_checksum_length
    assert_equal 5, p.profile.short_checksum_until
  end

  def test_effective_checksum_length_per_generation
    profile = expandable.profile
    assert_equal 1, profile.effective_checksum_length(4)
    assert_equal 1, profile.effective_checksum_length(5)
    assert_equal 2, profile.effective_checksum_length(6)
    assert_equal 2, profile.effective_checksum_length(8)
  end

  # Spec 22.3: capacities follow the effective K.
  def test_generation_capacities_follow_the_effective_k
    assert_equal 39_304, expandable.generation_capacity(4) # 34^3
    assert_equal 1_336_336, expandable.generation_capacity(5) # 34^4
    assert_equal 1_336_336, expandable.generation_capacity(6) # one symbol buys the second checksum
    assert_equal 45_435_424, expandable.generation_capacity(7)
    assert_equal 1_544_804_416, expandable.generation_capacity(8)
  end

  def test_round_trips_first_and_last_issuable_id_of_generations_4_through_8
    (4..8).each do |l|
      first = first_issuable(expandable, expandable.generation_base(l))
      last = expandable.generation_base(l + 1) - 1
      [first, last].each do |id|
        begin
          code = expandable.encode(id: id)
        rescue Baseh::BasehError => e
          assert_equal "BLOCKED_CODE", e.code, "id #{id} blocked"
          next
        end
        assert_equal l, raw(code).length
        result = expandable.decode(code)
        assert_equal id, result.id
        assert_equal code, result.canonical_code
      end
    end
  end

  def test_short_normal_boundary
    last_short = expandable.generation_base(6) - 1 # 1,375,639
    first_normal = expandable.generation_base(6) # 1,375,640
    a = raw(expandable.encode(id: last_short))
    assert_equal 5, a.length
    assert_equal 4, a.length - 1 # 1 checksum symbol at length 5
    assert_equal last_short, expandable.decode(a).id
    b = raw(expandable.encode(id: first_normal))
    assert_equal 6, b.length
    assert_equal 4, b.length - 2 # 2 checksum symbols at length 6
    assert_equal first_normal, expandable.decode(b).id
  end

  def test_a_4_character_code_validates_against_exactly_1_checksum_symbol
    id = first_issuable(expandable, 0)
    code = raw(expandable.encode(id: id))
    assert_equal 4, code.length
    assert_equal code[3], Baseh::Checksum.calculate_checksum(expandable.profile, code[0...3], nil, 1)
    # Flipping the single checksum symbol fails.
    check = code[3]
    bad = check == "0" ? "1" : "0"
    assert_error("INVALID_CHECKSUM") { expandable.decode("#{code[0...3]}#{bad}") }
    # Appending a second checksum symbol changes the generation; the split
    # moves and the code fails (spec 19.7), it never validates as gen 4 + 2.
    assert_error("INVALID_CHECKSUM") { expandable.decode(code + check) }
  end

  def test_checksum_values_at_short_generations_use_modulus_35_not_1225
    id = first_issuable(expandable, 0)
    body = raw(expandable.encode(id: id))[0...3]
    short = Baseh::Checksum.calculate_checksum(expandable.profile, body, nil, 1)
    full = Baseh::Checksum.calculate_checksum(expandable.profile, body, nil, 2)
    assert_equal 1, short.length
    assert_equal 2, full.length
    assert_equal raw(expandable.encode(id: id))[3], short
  end

  # Spec 22.4: the separator threshold is still a function of total length.
  def test_separator_threshold_unchanged
    # Length 5 renders bare even though its body grew; length 6 splits.
    refute_includes expandable.encode(id: expandable.generation_base(5)), "-"
    assert_match(/\A...-...\z/, expandable.encode(id: first_issuable(expandable, expandable.generation_base(6))))
  end

  # Spec 22.4: the repetition scan covers body plus the short checksum.
  def test_repetition_scan_covers_the_short_checksum
    # Probe with the filter off to find an id whose 4-symbol raw code is a
    # run of 4 (necessarily spanning body and the single checksum symbol),
    # then confirm the frozen tier blocks it.
    probe = Baseh::Baseh.new(Baseh.baseh_expandable_v1.merge(max_repetition: 0))
    found = nil
    0.upto(expandable.generation_base(5) - 1) do |id|
      begin
        code = probe.encode(id: id)
      rescue Baseh::BasehError
        next
      end
      r = raw(code)
      next unless r.length == 4 && /(.)\1{3}/.match?(r)

      found = id
      break
    end
    refute_nil found, "expected a gen-4 code with a run of 4"
    assert_error("BLOCKED_CODE") { expandable.encode(id: found) }
  end

  # Spec 22.2 validation.
  def test_rejects_the_fields_in_fixed_mode
    assert_error("INVALID_PROFILE") do
      Baseh::Baseh.new(Baseh.baseh_medium_v1.merge(short_checksum_length: 1, short_checksum_until: 5))
    end
    assert_error("INVALID_PROFILE") do
      Baseh::Baseh.new(Baseh.baseh_medium_v1.merge(short_checksum_until: 5))
    end
  end

  def test_rejects_short_checksum_length_at_or_above_checksum_length
    base = Baseh.baseh_expandable_v1
    assert_error("INVALID_PROFILE") do
      Baseh::Baseh.new(base.merge(short_checksum_length: 2, short_checksum_until: 5))
    end
    assert_error("INVALID_PROFILE") do
      Baseh::Baseh.new(base.merge(short_checksum_length: 3, short_checksum_until: 5))
    end
  end

  def test_rejects_short_checksum_until_below_min_length
    assert_error("INVALID_PROFILE") do
      Baseh::Baseh.new(Baseh.baseh_expandable_v1.merge(short_checksum_length: 1, short_checksum_until: 3))
    end
  end

  def test_rejects_min_length_at_or_below_short_checksum_length
    assert_error("INVALID_PROFILE") do
      Baseh::Baseh.new(
        Baseh.baseh_expandable_v1.merge(min_length: 1, short_checksum_length: 1, short_checksum_until: 5)
      )
    end
  end

  # Spec 22 amendment: the window field is the switch, so until + absent
  # length (defaults to 0) is the zero-checksum window, not an error.
  def test_until_without_short_checksum_length_is_a_legal_zero_window
    h = Baseh::Baseh.new(
      Baseh.baseh_expandable_v1.merge(short_checksum_length: 0, short_checksum_until: 5)
    )
    assert_equal 0, h.profile.short_checksum_length
    assert_equal 0, h.profile.effective_checksum_length(4)
  end

  def test_rejects_short_checksum_length_without_short_checksum_until
    plain = Baseh.baseh_expandable_v1.merge(short_checksum_length: 0, short_checksum_until: 0)
    assert_error("INVALID_PROFILE") do
      Baseh::Baseh.new(plain.merge(short_checksum_length: 1))
    end
  end

  def test_rejects_short_checksum_until_above_8
    assert_error("INVALID_PROFILE") do
      Baseh::Baseh.new(Baseh.baseh_expandable_v1.merge(short_checksum_length: 1, short_checksum_until: 9))
    end
  end

  def test_accepts_short_checksum_until_of_8
    h = Baseh::Baseh.new(
      Baseh.baseh_expandable_v1.merge(short_checksum_length: 1, short_checksum_until: 8)
    )
    assert_equal 1, h.profile.effective_checksum_length(8)
    assert_equal 2, h.profile.effective_checksum_length(9)
  end

  def test_rejects_a_non_integer_short_checksum_length
    assert_error("INVALID_PROFILE") do
      Baseh::Baseh.new(Baseh.baseh_expandable_v1.merge(short_checksum_length: 1.5, short_checksum_until: 5))
    end
  end

  def test_zero_or_absent_turns_the_feature_off
    off = Baseh::Baseh.new(
      Baseh.baseh_expandable_v1.merge(short_checksum_length: 0, short_checksum_until: 0)
    )
    assert_equal 0, off.profile.short_checksum_length
    assert_equal 1_156, off.generation_capacity(4)
    assert_equal 2, off.profile.effective_checksum_length(4)
    code = off.encode(id: 1_155)
    assert_equal 4, raw(code).length
    assert_equal 1_155, off.decode(code).id
  end

  def test_a_custom_short_checksum_window_round_trips_at_every_generation
    h = Baseh::Baseh.new(
      Baseh.baseh_expandable_v1.merge(
        profile_id: "short-window-test",
        min_length: 4,
        checksum_length: 2,
        short_checksum_length: 1,
        short_checksum_until: 6,
        permutation: { enabled: false },
        profanity: { mode: "none" },
        max_repetition: 0
      )
    )
    # Body sizes: 3, 4, 5 through length 6 (K = 1), then L - 2.
    assert_equal 34**3, h.generation_capacity(4)
    assert_equal 34**5, h.generation_capacity(6)
    assert_equal 34**5, h.generation_capacity(7) # K = 2 kicks in
    assert_operator h.generation_capacity(6), :>, h.generation_capacity(5)
    (4..8).each do |l|
      id = h.generation_base(l) + 7
      code = h.encode(id: id)
      assert_equal l, raw(code).length
      assert_equal id, h.decode(code).id
    end
  end

  # Spec 22 amendment: the zero-checksum window.
  def zero_window
    @zero_window ||= Baseh::Baseh.new(
      Baseh.baseh_expandable_v1.merge(
        profile_id: "short-zero-test",
        min_length: 4,
        checksum_length: 2,
        short_checksum_length: 0,
        short_checksum_until: 5,
        permutation: { enabled: false },
        profanity: { mode: "none" },
        max_repetition: 0
      )
    )
  end

  def test_zero_window_resolves_effective_k_of_zero_inside_checksum_length_above
    assert_equal 0, zero_window.profile.effective_checksum_length(4)
    assert_equal 0, zero_window.profile.effective_checksum_length(5)
    assert_equal 2, zero_window.profile.effective_checksum_length(6)
  end

  def test_zero_window_generations_are_all_body_capacity_is_a_to_the_l
    assert_equal 34**4, zero_window.generation_capacity(4)
    assert_equal 34**5, zero_window.generation_capacity(5)
    assert_equal 34**4, zero_window.generation_capacity(6) # K = 2 above the window
  end

  def test_zero_window_round_trips_generations_4_through_6_with_no_checksum_symbols
    (4..6).each do |l|
      [zero_window.generation_base(l), zero_window.generation_base(l + 1) - 1].each do |id|
        code = zero_window.encode(id: id)
        assert_equal l, raw(code).length
        assert_equal id, zero_window.decode(code).id
        assert_equal code, zero_window.decode(code).canonical_code
      end
    end
  end

  def test_zero_window_checksum_of_zero_symbols_is_the_empty_string
    code = raw(zero_window.encode(id: zero_window.generation_base(4)))
    assert_equal 4, code.length
    assert_equal "", Baseh::Checksum.calculate_checksum(zero_window.profile, code, nil, 0)
  end

  # A typo at a zero-checksum generation is NOT detected (documented
  # trade-off): there is no checksum to fail.
  def test_zero_window_typo_is_not_detected
    id = zero_window.generation_base(4) + 1
    code = raw(zero_window.encode(id: id))
    last = code[3]
    replacement = last == "1" ? "2" : "1"
    typed = "#{code[0...3]}#{replacement}"
    result = zero_window.decode(typed) # no error
    refute_equal id, result.id
  end

  # With no checksum there is nothing to correct against: any body decodes
  # as-is and correction never engages, like a checksumLength: 0 profile.
  def test_zero_window_correction_never_engages
    id = zero_window.generation_base(5) + 3
    code = raw(zero_window.encode(id: id))
    result = zero_window.decode(code, try_correction: true, confusion_profile: :heavy)
    assert_equal id, result.id
    refute result.corrected
    last = code[4]
    typed = "#{code[0...4]}#{last == '1' ? '2' : '1'}"
    mistyped = zero_window.decode(typed, try_correction: true, confusion_profile: :heavy)
    refute_equal id, mistyped.id
    refute mistyped.corrected
  end

  # Spec 22.4: the repetition scan covers the whole all-body code.
  def test_zero_window_repetition_scan_covers_the_all_body_code
    filtered = Baseh::Baseh.new(
      Baseh.baseh_expandable_v1.merge(
        profile_id: "short-zero-test",
        min_length: 4,
        checksum_length: 2,
        short_checksum_length: 0,
        short_checksum_until: 5,
        permutation: { enabled: false },
        profanity: { mode: "none" },
        max_repetition: 4
      )
    )
    found = nil
    0.upto(zero_window.generation_capacity(4) - 1) do |id|
      r = raw(zero_window.encode(id: id))
      next unless /(.)\1{3}/.match?(r)

      found = id
      break
    end
    refute_nil found, "expected a gen-4 code with a run of 4"
    assert_error("BLOCKED_CODE") { filtered.encode(id: found) }
  end

  # The until-8 window boundary: generation 8 carries one checksum symbol,
  # generation 9 carries two.
  def test_until_8_window_boundary
    h = Baseh::Baseh.new(
      Baseh.baseh_expandable_v1.merge(
        profile_id: "short-until-8-test",
        min_length: 4,
        checksum_length: 2,
        short_checksum_length: 1,
        short_checksum_until: 8,
        permutation: { enabled: false },
        profanity: { mode: "none" },
        max_repetition: 0
      )
    )
    id8 = h.generation_base(8) + 5
    c8 = raw(h.encode(id: id8))
    assert_equal 8, c8.length
    assert_equal c8[7..], Baseh::Checksum.calculate_checksum(h.profile, c8[0...7], nil, 1)
    assert_equal id8, h.decode(c8).id
    id9 = h.generation_base(9) + 5
    c9 = raw(h.encode(id: id9))
    assert_equal 9, c9.length
    assert_equal c9[7..], Baseh::Checksum.calculate_checksum(h.profile, c9[0...7], nil, 2)
    assert_equal id9, h.decode(c9).id
  end
end
