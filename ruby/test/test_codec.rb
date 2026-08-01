# frozen_string_literal: true

require "minitest/autorun"
require "baseh"

# Codec unit tests: profile validation, boundary round trips, correction,
# checksum properties, profanity safety (spec 18), sequential smoke and a
# deterministic fuzz smoke.
class TestCodec < Minitest::Test
  TEST_KEY = ["746573742d6f6e6c792d6b65792d6d6174657269616c2d30303031"].pack("H*")
  BODY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

  def medium
    @medium ||= Baseh::Baseh.new(
      Baseh.baseh_medium_p_v1(key_bytes: TEST_KEY, key_id: "test-01")
    )
  end

  def light
    @light ||= Baseh::Baseh.new(
      Baseh.baseh_light_p_v1(key_bytes: TEST_KEY, key_id: "test-01")
    )
  end

  # Test-local profile with the classic 32-symbol body and 26-symbol checksum
  # alphabet (modulus 26), so the checksum and correction suites exercise the
  # documented modulus-26 behaviour directly. No profanity, no permutation.
  def noperm
    @noperm ||= {
      profile_id: "baseh32-noperm-test",
      body_alphabet: BODY_ALPHABET,
      body_length: 6,
      checksum_alphabet: "234679ACDEFGHJKMNPQRTUVWXY",
      checksum_length: 1,
      case_sensitive: false,
      separator: "",
      grouping: [],
      aliases: { "O" => "0", "I" => "1", "L" => "1" },
      permutation: { enabled: false }
    }
  end

  def noperm_codec
    @noperm_codec ||= Baseh::Baseh.new(noperm)
  end

  # --- profile validation (spec 2.2) ---

  def assert_invalid_profile(profile)
    error = assert_raises(Baseh::BasehError) { Baseh::Baseh.new(profile) }
    assert_equal "INVALID_PROFILE", error.code
  end

  def base_profile
    {
      profile_id: "unit-test",
      body_alphabet: BODY_ALPHABET,
      body_length: 6,
      checksum_alphabet: "234679ACDEFGHJKMNPQRTUVWXY",
      checksum_length: 1,
      case_sensitive: false,
      separator: "-",
      grouping: [3, 3, 1],
      aliases: { "O" => "0", "I" => "1", "L" => "1" },
      permutation: { enabled: false }
    }
  end

  def test_rejects_empty_profile_id
    assert_invalid_profile(base_profile.merge(profile_id: ""))
  end

  def test_rejects_non_ascii_profile_id
    assert_invalid_profile(base_profile.merge(profile_id: "baseh\xC3\xA9".encode("UTF-8")))
  end

  def test_rejects_tiny_body_alphabet
    assert_invalid_profile(base_profile.merge(body_alphabet: "A"))
  end

  def test_rejects_duplicate_body_symbols
    assert_invalid_profile(base_profile.merge(body_alphabet: "0123ABC0A".dup + "DEFGHJKMNPQRSTVWX"))
  end

  def test_rejects_case_collision_in_body
    # "e" and existing "E" collide once case-normalized.
    alphabet = BODY_ALPHABET.sub("Y", "e")
    assert_invalid_profile(base_profile.merge(body_alphabet: alphabet))
  end

  def test_rejects_non_ascii_body_symbol
    assert_invalid_profile(base_profile.merge(body_alphabet: "01\xC3\x9c".encode("UTF-8")))
  end

  def test_rejects_bad_body_length
    assert_invalid_profile(base_profile.merge(body_length: 0))
    assert_invalid_profile(base_profile.merge(body_length: -1))
    assert_invalid_profile(base_profile.merge(body_length: 33))
  end

  def test_rejects_bad_checksum_length
    assert_invalid_profile(base_profile.merge(checksum_length: -1))
    assert_invalid_profile(base_profile.merge(checksum_length: 9))
  end

  def test_rejects_small_checksum_alphabet
    assert_invalid_profile(base_profile.merge(checksum_alphabet: "2"))
  end

  def test_rejects_separator_in_body_alphabet
    assert_invalid_profile(base_profile.merge(separator: "0"))
  end

  def test_rejects_separator_in_checksum_alphabet
    assert_invalid_profile(base_profile.merge(separator: "2"))
  end

  def test_rejects_alias_target_not_canonical
    assert_invalid_profile(base_profile.merge(aliases: { "Q0" => "0" }))
    assert_invalid_profile(base_profile.merge(aliases: { "Z" => "!" }))
  end

  def test_rejects_alias_source_that_is_canonical
    assert_invalid_profile(base_profile.merge(aliases: { "0" => "1" }))
  end

  def test_rejects_alias_chain
    assert_invalid_profile(base_profile.merge(aliases: { "O" => "U", "U" => "0" }))
  end

  def test_rejects_alias_cycle
    assert_invalid_profile(base_profile.merge(aliases: { "O" => "U", "U" => "0", "!" => "O" }))
  end

  def test_rejects_group_total_mismatch
    assert_invalid_profile(base_profile.merge(grouping: [3, 3]))
    assert_invalid_profile(base_profile.merge(grouping: [3, 3, 2]))
  end

  def test_rejects_non_positive_group
    assert_invalid_profile(base_profile.merge(grouping: [3, 4, 0]))
  end

  def test_empty_separator_requires_empty_grouping
    assert_invalid_profile(base_profile.merge(separator: "", grouping: [7]))
    assert Baseh::Baseh.new(base_profile.merge(separator: "", grouping: []))
  end

  def test_rejects_missing_permutation_key
    perm = { enabled: true, algorithm: "feistel-v1", key_id: "k", key_bytes: "", rounds: 8 }
    assert_invalid_profile(base_profile.merge(permutation: perm))
    perm = perm.merge(key_bytes: nil)
    assert_invalid_profile(base_profile.merge(permutation: perm))
  end

  def test_rejects_bad_rounds
    perm = { enabled: true, algorithm: "feistel-v1", key_id: "k", key_bytes: "k", rounds: 5 }
    assert_invalid_profile(base_profile.merge(permutation: perm))
    [1, 3, 18, 0].each do |rounds|
      assert_invalid_profile(base_profile.merge(permutation: perm.merge(rounds: rounds)))
    end
  end

  def test_accepts_shipped_profiles
    assert Baseh::Baseh.new(Baseh.baseh_minimum_v1)
    assert Baseh::Baseh.new(Baseh.baseh_light_v1)
    assert Baseh::Baseh.new(Baseh.baseh_medium_v1)
    assert Baseh::Baseh.new(Baseh.baseh_heavy_v1)
    assert Baseh::Baseh.new(Baseh.baseh_minimum_p_v1(key_bytes: TEST_KEY))
    assert Baseh::Baseh.new(Baseh.baseh_light_p_v1(key_bytes: TEST_KEY))
    assert Baseh::Baseh.new(Baseh.baseh_medium_p_v1(key_bytes: TEST_KEY))
    assert Baseh::Baseh.new(Baseh.baseh_heavy_p_v1(key_bytes: TEST_KEY))
  end

  # --- frozen tier helpers ---

  def test_plain_helpers_permute_with_the_frozen_published_key
    [Baseh.baseh_minimum_v1,
     Baseh.baseh_light_v1,
     Baseh.baseh_medium_v1,
     Baseh.baseh_heavy_v1].each do |profile|
      permutation = profile[:permutation]
      assert_equal true, permutation[:enabled]
      assert_equal "feistel-v1", permutation[:algorithm]
      assert_equal "frozen", permutation[:key_id]
      assert_equal Baseh::FROZEN_KEY_BYTES, permutation[:key_bytes]
      assert_equal 8, permutation[:rounds]
      codec = Baseh::Baseh.new(profile)
      assert_equal 42, codec.decode(codec.encode(id: 42)).id
    end
  end

  def test_frozen_tier_shapes
    minimum = Baseh.baseh_minimum_v1
    assert_equal 0, minimum[:checksum_length]
    assert_equal "-", minimum[:separator]
    assert_equal [3, 3], minimum[:grouping]
    [Baseh.baseh_light_v1, Baseh.baseh_medium_v1, Baseh.baseh_heavy_v1].each do |profile|
      assert_equal 2, profile[:checksum_length]
      assert_equal "-", profile[:separator]
      assert_equal [4, 4], profile[:grouping]
    end
  end

  def test_frozen_and_private_keys_scramble_differently
    frozen = Baseh::Baseh.new(Baseh.baseh_medium_v1)
    privy = Baseh::Baseh.new(Baseh.baseh_medium_p_v1(key_bytes: TEST_KEY))
    assert_equal 123_456, frozen.decode(frozen.encode(id: 123_456)).id
    refute_equal frozen.encode(id: 123_456), privy.encode(id: 123_456)
  end

  def test_keyed_helpers_enable_feistel_v1
    [Baseh.baseh_minimum_p_v1(key_bytes: TEST_KEY),
     Baseh.baseh_light_p_v1(key_bytes: TEST_KEY),
     Baseh.baseh_medium_p_v1(key_bytes: TEST_KEY),
     Baseh.baseh_heavy_p_v1(key_bytes: TEST_KEY)].each do |profile|
      permutation = profile[:permutation]
      assert_equal true, permutation[:enabled]
      assert_equal "feistel-v1", permutation[:algorithm]
      assert_equal "default", permutation[:key_id]
      assert_equal TEST_KEY, permutation[:key_bytes]
      assert_equal 8, permutation[:rounds]
      codec = Baseh::Baseh.new(profile)
      assert_equal 42, codec.decode(codec.encode(id: 42)).id
    end
  end

  def test_keyed_helpers_apply_key_id_and_rounds_overrides
    profile = Baseh.baseh_medium_p_v1(key_bytes: TEST_KEY, key_id: "k-2", rounds: 10)
    assert_equal "k-2", profile[:permutation][:key_id]
    assert_equal 10, profile[:permutation][:rounds]
  end

  def test_keyed_helpers_require_key_bytes
    assert_raises(ArgumentError) { Baseh.baseh_medium_p_v1 }
  end

  def test_keyed_profile_ids_carry_p_segment
    assert_equal "baseh-minimum-p-v1",
                 Baseh.baseh_minimum_p_v1(key_bytes: TEST_KEY)[:profile_id]
    assert_equal "baseh-light-p-v1",
                 Baseh.baseh_light_p_v1(key_bytes: TEST_KEY)[:profile_id]
    assert_equal "baseh-medium-p-v1",
                 Baseh.baseh_medium_p_v1(key_bytes: TEST_KEY)[:profile_id]
    assert_equal "baseh-heavy-p-v1",
                 Baseh.baseh_heavy_p_v1(key_bytes: TEST_KEY)[:profile_id]
  end

  def test_helpers_return_fresh_mutable_profiles
    first = Baseh.baseh_medium_v1
    second = Baseh.baseh_medium_v1
    refute_same first, second
    refute_same first[:aliases], second[:aliases]
    first[:body_alphabet] << "!"
    first[:aliases]["J"] = "0"
    refute_equal first, Baseh.baseh_medium_v1
  end

  # --- base-N unit behaviour (test-suite section 4) ---

  def hex_profile
    base_profile.merge(
      body_alphabet: "0123456789ABCDEF",
      body_length: 4,
      grouping: [4, 1]
    )
  end

  def test_base_n_fixed_points
    codec = Baseh::Baseh.new(hex_profile)
    {
      0 => "0000", 1 => "0001", 15 => "000F", 16 => "0010",
      255 => "00FF", 256 => "0100", 65_535 => "FFFF"
    }.each do |id, body|
      code = codec.encode(id: id)
      assert_equal body, code.delete("-")[0, 4]
    end
  end

  def test_base_n_rejects_out_of_range
    codec = Baseh::Baseh.new(hex_profile)
    [-1, 65_536, 1_000_000].each do |id|
      error = assert_raises(Baseh::BasehError) { codec.encode(id: id) }
      assert_equal "OUT_OF_RANGE", error.code
    end
  end

  # --- boundary round trips (test-suite section 5) ---

  def test_frozen_profiles_have_documented_tiers_and_capacities
    assert_equal 2_176_782_336, Baseh::Baseh.new(Baseh.baseh_minimum_v1).capacity
    assert_equal 887_503_681, Baseh::Baseh.new(Baseh.baseh_light_v1).capacity
    assert_equal 481_890_304, Baseh::Baseh.new(Baseh.baseh_medium_v1).capacity
    assert_equal 308_915_776, Baseh::Baseh.new(Baseh.baseh_heavy_v1).capacity
  end

  def test_boundary_round_trips
    [0, 1, 31, 32, 33, 481_890_302, 481_890_303].each do |id|
      [medium, light, noperm_codec].each do |codec|
        result = codec.decode(codec.encode(id: id))
        assert_equal id, result.id
        assert_equal codec.encode(id: id), result.canonical_code
      end
    end
  end

  def test_capacity_encode_rejected
    [medium, light].each do |codec|
      error = assert_raises(Baseh::BasehError) { codec.encode(id: codec.capacity) }
      assert_equal "OUT_OF_RANGE", error.code
    end
  end

  def test_encoder_never_emits_alias_sources
    # Medium tier aliases O/I/L/B/S/T/N/W; none may appear in issued codes.
    # B and S are covered by a dedicated test below. The tier blocklist
    # reserves some ids, so skip those.
    codec = Baseh::Baseh.new(Baseh.baseh_medium_v1)
    1_000.times do |i|
      begin
        code = codec.encode(id: i * 997)
      rescue Baseh::BasehError => e
        assert_equal "BLOCKED_CODE", e.code
        next
      end
      refute_match(/[OILTNW]/, code)
    end
    # The classic 32-symbol alphabet aliases only O/I/L.
    1_000.times do |i|
      refute_match(/[OIL]/, noperm_codec.encode(id: i * 997))
    end
  end

  # --- normalization and aliases (test-suite sections 7-8) ---

  def test_lowercase_and_whitespace_decode
    code = medium.encode(id: 42)
    assert_equal 42, medium.decode(code.downcase).id
    assert_equal 42, medium.decode("  #{code}  ").id
    assert_equal 42, medium.decode("\t#{code}\n").id
  end

  def test_separator_chars_rejected_when_no_separator_configured
    code = noperm_codec.encode(id: 42)
    error = assert_raises(Baseh::BasehError) { noperm_codec.decode(code[0, 3] + "-" + code[3..]) }
    assert_equal "INVALID_CHARACTER", error.code
  end

  def test_alias_input_decodes
    # O maps to 0. id 0 encodes to body "000000" plus its checksum.
    raw_code = noperm_codec.encode(id: 0)
    assert_equal 0, noperm_codec.decode(raw_code.sub("0", "O")).id

    # I and L map to 1. Find an id whose body contains a canonical 1.
    id_of_one = noperm_codec.profile.body_alphabet.index("1")
    raw_one = noperm_codec.encode(id: id_of_one)
    assert raw_one.include?("1")
    assert_equal id_of_one, noperm_codec.decode(raw_one.sub("1", "I")).id
    assert_equal id_of_one, noperm_codec.decode(raw_one.sub("1", "L")).id
    assert_equal id_of_one, noperm_codec.decode(raw_one.sub("1", "i")).id

    # Unknown alias source fails. U is absent from the classic alphabet.
    error = assert_raises(Baseh::BasehError) { noperm_codec.decode("UUUUUUU") }
    assert_equal "INVALID_CHARACTER", error.code
  end

  def test_accept_spaces_option
    code = medium.encode(id: 7)
    spaced = code.chars.join(" ")
    assert_equal 7, medium.decode(spaced, accept_spaces: true).id
    error = assert_raises(Baseh::BasehError) { medium.decode(spaced) }
    assert_equal "INVALID_CHARACTER", error.code
  end

  def test_validate_never_raises_on_user_input
    ["", nil, 42, "@@@@", "0" * 100, "OIOIL01", "a b c"].each do |input|
      result = medium.validate(input)
      assert_includes [true, false], result.valid
      if result.valid
        refute_nil result.canonical_code
      else
        assert_includes Baseh::BasehError::CODES, result.reason
      end
    end
  end

  # --- checksum properties (test-suite section 6) ---

  def raw_body(codec, id)
    codec.encode(id: id)[0, codec.profile.body_length]
  end

  def test_checksum_deterministic
    body = raw_body(noperm_codec, 123_456)
    a = Baseh::Checksum.calculate_checksum(noperm_codec.profile, body)
    b = Baseh::Checksum.calculate_checksum(noperm_codec.profile, body)
    assert_equal a, b
  end

  def test_checksum_changes_with_body_symbol
    body_alphabet = noperm_codec.profile.body_alphabet
    body = raw_body(noperm_codec, 123_456)
    index = Baseh::BaseN.alphabet_index(body_alphabet)
    original = Baseh::Checksum.calculate_checksum(noperm_codec.profile, body)
    changed = body.dup
    changed[3] = body_alphabet[(index[body[3]] + 1) % body_alphabet.length]
    altered = Baseh::Checksum.calculate_checksum(noperm_codec.profile, changed)
    # Modulus-26 checksums have documented structured misses, so only check
    # same-position swaps with delta 1 (always detected since 1 is not a
    # multiple of 26).
    refute_equal original, altered
  end

  def test_checksum_depends_on_profile_id
    other = noperm.merge(profile_id: "other-id")
    body = raw_body(noperm_codec, 99)
    a = Baseh::Checksum.calculate_checksum(noperm_codec.profile, body)
    b = Baseh::Checksum.calculate_checksum(Baseh::Baseh.new(other).profile, body)
    refute_equal a, b
  end

  def test_checksum_fixed_width
    100.times do |i|
      assert_equal 9, medium.encode(id: i * 1234).length
    end
    100.times do |i|
      assert_equal 9, light.encode(id: i * 1234).length
    end
  end

  # --- look-alike aliases on the frozen medium tier ---

  def plain_medium
    @plain_medium ||= Baseh::Baseh.new(Baseh.baseh_medium_v1)
  end

  # First medium code containing sym, searching ids upward. The tier
  # blocklist reserves some ids; skip those.
  def first_medium_code_with(sym)
    (1..5_000_000).each do |id|
      begin
        code = plain_medium.encode(id: id)
      rescue Baseh::BasehError => e
        raise unless e.code == "BLOCKED_CODE"
        next
      end
      return [id, code] if code.include?(sym)
    end
    raise "no medium code contains #{sym} in range"
  end

  def test_medium_typed_b_decodes_as_8
    id, code = first_medium_code_with("8")
    result = plain_medium.decode(code.sub("8", "B"))
    assert_equal id, result.id
    refute result.corrected
  end

  def test_medium_typed_s_decodes_as_5_and_lowercase_works
    id, code = first_medium_code_with("5")
    assert_equal id, plain_medium.decode(code.sub("5", "S")).id
    assert_equal id, plain_medium.decode(code.sub("5", "s")).id
    refute plain_medium.decode(code.sub("5", "S")).corrected
  end

  def test_medium_genuinely_wrong_symbol_still_fails_checksum
    _id, code = first_medium_code_with("8")
    wrong = code.sub("8", "7")
    error = assert_raises(Baseh::BasehError) { plain_medium.decode(wrong) }
    assert_equal "INVALID_CHECKSUM", error.code
  end

  def test_medium_encode_never_emits_b_or_s
    2_000.times do |id|
      begin
        code = plain_medium.encode(id: id)
      rescue Baseh::BasehError => e
        # Blocklisted identifiers are reserved and never issued; skip them.
        assert_equal "BLOCKED_CODE", e.code
        next
      end
      refute_match(/[BS]/, code)
    end
  end

  # --- correction (test-suite section 9) ---

  def test_correction_light_finds_single_substitution
    # Find an id whose body ends in P, then swap the last body symbol to T.
    # P and T are a pair in the light confusion map.
    id = (0..1000).find { |i| noperm_codec.encode(id: i)[5] == "P" }
    raw_id = noperm_codec.encode(id: id)
    confused = raw_id[0, 5] + "T" + raw_id[6..]

    error = assert_raises(Baseh::BasehError) { noperm_codec.decode(confused) }
    assert_equal "INVALID_CHECKSUM", error.code

    result = noperm_codec.decode(confused, try_correction: true, confusion_profile: :light)
    assert_equal id, result.id
    assert result.corrected
    assert_equal noperm_codec.encode(id: id), result.canonical_code
  end

  def test_correction_no_result_raises_invalid_checksum
    # K is a valid body symbol but not a source in the light confusion map,
    # so no candidate can restore the checksum.
    raw = noperm_codec.encode(id: 0)
    confused = "K" + raw[1..]
    error = assert_raises(Baseh::BasehError) do
      noperm_codec.decode(confused, try_correction: true, confusion_profile: :light)
    end
    assert_equal "INVALID_CHECKSUM", error.code
  end

  def test_correction_requires_flag
    error = assert_raises(Baseh::BasehError) { noperm_codec.decode("0000TBC") }
    assert_equal "INVALID_CHECKSUM", error.code
  end

  def test_candidate_cap
    map = Hash.new { |h, k| h[k] = (BODY_ALPHABET.chars - [k]).first(11) }
    error = assert_raises(Baseh::BasehError) do
      noperm_codec.generate_candidates("ABCDEF", map, 1)
    end
    assert_equal "TOO_MANY_CANDIDATES", error.code
  end

  def test_max_corrections_zero_disables_correction
    error = assert_raises(Baseh::BasehError) do
      noperm_codec.decode("0000TBC", try_correction: true,
                                      confusion_profile: :light, max_corrections: 0)
    end
    assert_equal "INVALID_CHECKSUM", error.code
  end

  def test_correction_ignores_replacements_outside_the_body_alphabet
    # baseh-medium drops B, S and T. A P in the body under confusion light
    # would suggest a T that can never validate; that candidate must be
    # filtered out and the failure reported as INVALID_CHECKSUM, never thrown
    # as INVALID_CHARACTER from the checksum step.
    code = nil
    (100_000..1_000_000).each do |id|
      begin
        candidate = plain_medium.encode(id: id)
      rescue Baseh::BasehError => e
        raise unless e.code == "BLOCKED_CODE"
        next
      end
      (code = candidate) && break if candidate.include?("P")
    end
    assert code, "expected a medium code containing P"
    bad = code[0..-2] + (code.end_with?("2") ? "3" : "2")
    error = assert_raises(Baseh::BasehError) do
      plain_medium.decode(bad, try_correction: true, confusion_profile: :light)
    end
    assert_equal "INVALID_CHECKSUM", error.code
  end

  # --- profanity safety (spec 18) ---

  def test_rejects_unknown_profanity_mode
    assert_invalid_profile(base_profile.merge(profanity: { mode: "aggressive" }))
  end

  def test_rejects_malformed_blocklist_entries
    ["A", "A" * 33, "FU2", "SH T"].each do |word|
      assert_invalid_profile(base_profile.merge(profanity: { mode: "blocklist", words: [word] }))
    end
  end

  def test_blocklist_encode_raises_blocked_code
    codec = Baseh::Baseh.new(
      base_profile.merge(separator: "", grouping: [],
                         profanity: { mode: "blocklist", words: ["AAAA"] })
    )
    blocked_id = Baseh::BaseN.decode_base_n("AAAA00", BODY_ALPHABET)
    error = assert_raises(Baseh::BasehError) { codec.encode(id: blocked_id) }
    assert_equal "BLOCKED_CODE", error.code
    refute error.safe_for_customer
    # A neighbouring clean id encodes fine.
    assert codec.encode(id: blocked_id - 1)
  end

  def test_blocklist_default_list_applies_without_words
    codec = Baseh::Baseh.new(
      base_profile.merge(separator: "", grouping: [],
                         profile_id: "default-list", profanity: { mode: "blocklist" })
    )
    blocked_id = Baseh::BaseN.decode_base_n("DAMN00", BODY_ALPHABET)
    error = assert_raises(Baseh::BasehError) { codec.encode(id: blocked_id) }
    assert_equal "BLOCKED_CODE", error.code
  end

  def test_blocklist_extra_words_augment_default
    codec = Baseh::Baseh.new(
      base_profile.merge(separator: "", grouping: [],
                         profile_id: "extra-list",
                         profanity: { mode: "blocklist", extra_words: ["QQQQ"] })
    )
    blocked_id = Baseh::BaseN.decode_base_n("QQQQ00", BODY_ALPHABET)
    error = assert_raises(Baseh::BasehError) { codec.encode(id: blocked_id) }
    assert_equal "BLOCKED_CODE", error.code
    # The default list is still armed.
    damn_id = Baseh::BaseN.decode_base_n("DAMN00", BODY_ALPHABET)
    assert_equal "BLOCKED_CODE",
                 assert_raises(Baseh::BasehError) { codec.encode(id: damn_id) }.code
  end

  def test_blocklist_words_replace_default
    codec = Baseh::Baseh.new(
      base_profile.merge(separator: "", grouping: [],
                         profile_id: "replace-list",
                         profanity: { mode: "blocklist", words: ["ZZZZ"] })
    )
    zzzz_id = Baseh::BaseN.decode_base_n("ZZZZ00", BODY_ALPHABET)
    assert_equal "BLOCKED_CODE",
                 assert_raises(Baseh::BasehError) { codec.encode(id: zzzz_id) }.code
    # words replaces the default list, so DAMN now passes validation.
    damn_id = Baseh::BaseN.decode_base_n("DAMN00", BODY_ALPHABET)
    assert codec.encode(id: damn_id)
  end

  def test_blocklist_scan_includes_checksum_character
    codec = Baseh::Baseh.new(
      base_profile.merge(separator: "", grouping: [],
                         profile_id: "checksum-scan",
                         profanity: { mode: "blocklist", words: ["QQQ"] })
    )
    # Find an id whose raw code contains three Q symbols.
    hit = (0...1_000_000).find do |i|
      body = Baseh::BaseN.encode_base_n(i, BODY_ALPHABET, 6)
      checksum = Baseh::Checksum.calculate_checksum(codec.profile, body)
      (body + checksum).include?("QQQ")
    end
    assert hit, "expected to find a colliding id"
    assert_equal "BLOCKED_CODE",
                 assert_raises(Baseh::BasehError) { codec.encode(id: hit) }.code
  end

  def test_blocklist_matching_is_case_insensitive_for_case_sensitive_profiles
    sensitive = base_profile.merge(
      case_sensitive: true,
      body_alphabet: "abcdefghijklmnopqrstuvwxyz0123456789",
      checksum_alphabet: "acegikmoqsuwy",
      aliases: {},
      separator: "",
      grouping: [],
      profile_id: "lower-block",
      profanity: { mode: "blocklist", words: ["DAMN"] }
    )
    codec = Baseh::Baseh.new(sensitive)
    blocked_id = Baseh::BaseN.decode_base_n("damn00", "abcdefghijklmnopqrstuvwxyz0123456789")
    assert_equal "BLOCKED_CODE",
                 assert_raises(Baseh::BasehError) { codec.encode(id: blocked_id) }.code
  end

  def test_no_vowels_strips_alphabets_and_changes_capacity
    codec = Baseh::Baseh.new(
      base_profile.merge(separator: "", grouping: [],
                         profanity: { mode: "no-vowels" })
    )
    assert_equal 30**6, codec.capacity
    refute_includes codec.profile.body_alphabet, "A"
    refute_includes codec.profile.body_alphabet, "E"
    refute_includes codec.profile.checksum_alphabet, "A"
    refute_includes codec.profile.checksum_alphabet, "E"
    # Round trips still work and encoder never emits vowels.
    [0, 1, 123_456, codec.capacity - 1].each do |id|
      assert_equal id, codec.decode(codec.encode(id: id)).id
    end
    refute_match(/[AEIOU]/, codec.encode(id: 123_456))
  end

  def test_no_vowels_rejects_vowel_input
    codec = Baseh::Baseh.new(
      base_profile.merge(separator: "", grouping: [],
                         profanity: { mode: "no-vowels" })
    )
    error = assert_raises(Baseh::BasehError) { codec.decode("0000A02") }
    assert_equal "INVALID_CHARACTER", error.code
  end

  def test_no_vowels_alias_source_may_be_a_stripped_vowel
    # O, I and L are stripped vowels here (O and I are; L is consonant but
    # absent from the canonical alphabet). Aliases still accept them.
    codec = Baseh::Baseh.new(
      base_profile.merge(separator: "", grouping: [],
                         profanity: { mode: "no-vowels" })
    )
    raw = codec.encode(id: 0)
    assert_equal 0, codec.decode(raw.sub("0", "O")).id
  end

  def test_no_vowels_rejects_alphabet_that_strips_below_two
    assert_invalid_profile(
      base_profile.merge(body_alphabet: "AEIOU0", separator: "", grouping: [],
                         profanity: { mode: "no-vowels" },
                         aliases: {})
    )
    assert_invalid_profile(
      base_profile.merge(checksum_alphabet: "AE", separator: "", grouping: [],
                         profanity: { mode: "no-vowels" })
    )
  end

  # --- permutation properties (test-suite section 10) ---

  def test_feistel_bijection_small_domain
    skip "exhaustive check kept fast" if ENV["SLOW"] != "1"
    capacity = 10_000
    args = { profile_id: "bijection", key_bytes: TEST_KEY, rounds: 4 }
    seen = Array.new(capacity, false)
    capacity.times do |i|
      p = Baseh::Feistel.permute(i, capacity, **args)
      assert_operator p, :<, capacity
      refute seen[p]
      seen[p] = true
      assert_equal i, Baseh::Feistel.inverse_permute(p, capacity, **args)
    end
  end

  def test_feistel_key_and_profile_change_mapping
    capacity = 100_000
    a = Baseh::Feistel.permute(123, capacity,
                                   profile_id: "p1", key_bytes: TEST_KEY, rounds: 8)
    b = Baseh::Feistel.permute(123, capacity,
                                   profile_id: "p1", key_bytes: "other-key", rounds: 8)
    c = Baseh::Feistel.permute(123, capacity,
                                   profile_id: "p2", key_bytes: TEST_KEY, rounds: 8)
    refute_equal a, b
    refute_equal a, c
  end

  # --- smoke: sequential ids and fuzz ---

  def test_sequential_round_trip_smoke
    limit = ENV["SLOW"] == "1" ? 10_000 : 1_000
    limit.times do |id|
      begin
        code = medium.encode(id: id)
      rescue Baseh::BasehError => e
        # The tier blocklist reserves some ids; skip those and round-trip the
        # rest.
        assert_equal "BLOCKED_CODE", e.code
        next
      end
      assert_equal id, medium.decode(code).id
    end
  end

  def test_fuzz_smoke_only_raises_baseh_error
    rng = Random.new(42)
    alphabet = (0x00..0x7f).map(&:chr)
    5_000.times do
      length = rng.rand(0..40)
      input = Array.new(length) { alphabet[rng.rand(alphabet.size)] }.join
      begin
        medium.decode(input)
      rescue Baseh::BasehError
        # expected category
      end
      # validate must never raise on user input
      result = medium.validate(input)
      assert_includes [true, false], result.valid
    end
    # Very long string must not hang or blow up.
    result = medium.validate("0" * 10_000)
    refute result.valid
  end

  def test_fuzz_with_correction_options
    rng = Random.new(42)
    chars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ234679- "
    5_000.times do
      input = Array.new(rng.rand(6..9)) { chars.chars[rng.rand(chars.size)] }.join
      begin
        noperm_codec.decode(input, accept_spaces: rng.rand(2).zero?,
                                      try_correction: rng.rand(2).zero?,
                                      confusion_profile: %i[none light medium heavy][rng.rand(4)])
      rescue Baseh::BasehError
        # expected category
      end
    end
  end

  def test_fuzz_no_vowels_profile_never_crashes
    rng = Random.new(42)
    codec = Baseh::Baseh.new(
      base_profile.merge(separator: "", grouping: [],
                         profanity: { mode: "no-vowels" })
    )
    chars = "AEIOU0123456789BCDFGHJKMNPQRSTVWXZ- "
    2_000.times do
      input = Array.new(rng.rand(0..10)) { chars.chars[rng.rand(chars.size)] }.join
      begin
        codec.decode(input)
      rescue Baseh::BasehError
        # expected category
      end
    end
  end

  # --- multi-character separators (literal substring, not a character class) ---

  def test_multi_character_separator_round_trip
    codec = Baseh::Baseh.new(base_profile.merge(separator: ".."))
    [0, 1, 123_456, codec.capacity - 1].each do |id|
      code = codec.encode(id: id)
      assert_includes code, ".."
      result = codec.decode(code)
      assert_equal id, result.id
      assert_equal code, result.canonical_code
      refute result.corrected
    end
  end

  def test_multi_character_separator_is_removed_literally
    # String#delete would treat ".." as a character class and strip every
    # lone "."; JS split-join (and Ruby gsub) remove only the full separator,
    # so a single "." stays and fails as an invalid character.
    codec = Baseh::Baseh.new(base_profile.merge(separator: ".."))
    code = codec.encode(id: 123_456)
    error = assert_raises(Baseh::BasehError) { codec.decode(code.sub("..", ".")) }
    assert_equal "INVALID_CHARACTER", error.code
  end

  # --- base-N guards and module visibility ---

  def test_encode_base_n_rejects_out_of_range_values
    [BODY_ALPHABET.length**6, BODY_ALPHABET.length**6 + 1, -1].each do |value|
      error = assert_raises(Baseh::BasehError) do
        Baseh::BaseN.encode_base_n(value, BODY_ALPHABET, 6)
      end
      assert_equal "OUT_OF_RANGE", error.code
    end
    # The boundary value itself still encodes.
    assert_equal 6, Baseh::BaseN.encode_base_n(BODY_ALPHABET.length**6 - 1, BODY_ALPHABET, 6).length
  end

  def test_feistel_exposes_only_the_permutations
    assert_respond_to Baseh::Feistel, :permute
    assert_respond_to Baseh::Feistel, :inverse_permute
    %i[walk run_rounds run_inverse round_message bit_length low_bits to_be hmac].each do |helper|
      refute_respond_to Baseh::Feistel, helper
    end
  end
end
