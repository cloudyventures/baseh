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

  def test_rejects_short_checksum_until_without_short_checksum_length
    plain = Baseh.baseh_expandable_v1.merge(short_checksum_length: 0, short_checksum_until: 0)
    assert_error("INVALID_PROFILE") do
      Baseh::Baseh.new(plain.merge(short_checksum_until: 5))
    end
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
end
