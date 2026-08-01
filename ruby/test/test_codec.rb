# frozen_string_literal: true

require "minitest/autorun"
require "base_human"

# Codec unit tests: profile validation, boundary round trips, correction,
# checksum properties, profanity safety (spec 18), sequential smoke and a
# deterministic fuzz smoke.
class TestCodec < Minitest::Test
  TEST_KEY = ["746573742d6f6e6c792d6b65792d6d6174657269616c2d30303031"].pack("H*")
  BODY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

  def baseh32
    @baseh32 ||= BaseHuman::Baseh.new(BaseHuman.baseh32_v1(key_bytes: TEST_KEY, key_id: "test-01"))
  end

  def baseh32s
    @baseh32s ||= BaseHuman::Baseh.new(BaseHuman.baseh32s_v1(key_bytes: TEST_KEY, key_id: "test-01"))
  end

  def noperm
    @noperm ||= BaseHuman.baseh32_v1(key_bytes: TEST_KEY, key_id: "test-01")
                            .merge(profile_id: "baseh32-noperm-test",
                                   permutation: { enabled: false })
  end

  def noperm_codec
    @noperm_codec ||= BaseHuman::Baseh.new(noperm)
  end

  # --- profile validation (spec 2.2) ---

  def assert_invalid_profile(profile)
    error = assert_raises(BaseHuman::BasehError) { BaseHuman::Baseh.new(profile) }
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
    assert BaseHuman::Baseh.new(base_profile.merge(separator: "", grouping: []))
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
    assert BaseHuman::Baseh.new(BaseHuman.baseh32_v1(key_bytes: TEST_KEY, key_id: "k"))
    assert BaseHuman::Baseh.new(BaseHuman.baseh32s_v1(key_bytes: TEST_KEY, key_id: "k"))
  end

  # --- helper key optionality ---

  def test_helpers_without_key_disable_permutation
    [BaseHuman.baseh32_v1, BaseHuman.baseh32s_v1].each do |profile|
      assert_equal({ enabled: false }, profile[:permutation])
      codec = BaseHuman::Baseh.new(profile)
      assert_equal 42, codec.decode(codec.encode(id: 42)).id
    end
  end

  def test_helpers_with_key_enable_feistel_v1
    [BaseHuman.baseh32_v1(key_bytes: TEST_KEY),
     BaseHuman.baseh32s_v1(key_bytes: TEST_KEY)].each do |profile|
      permutation = profile[:permutation]
      assert_equal true, permutation[:enabled]
      assert_equal "feistel-v1", permutation[:algorithm]
      assert_equal "default", permutation[:key_id]
      assert_equal TEST_KEY, permutation[:key_bytes]
      assert_equal 8, permutation[:rounds]
      codec = BaseHuman::Baseh.new(profile)
      assert_equal 42, codec.decode(codec.encode(id: 42)).id
    end
  end

  def test_helpers_apply_key_id_and_rounds_overrides
    profile = BaseHuman.baseh32_v1(key_bytes: TEST_KEY, key_id: "k-2", rounds: 10)
    assert_equal "k-2", profile[:permutation][:key_id]
    assert_equal 10, profile[:permutation][:rounds]
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
    codec = BaseHuman::Baseh.new(hex_profile)
    {
      0 => "0000", 1 => "0001", 15 => "000F", 16 => "0010",
      255 => "00FF", 256 => "0100", 65_535 => "FFFF"
    }.each do |id, body|
      code = codec.encode(id: id)
      assert_equal body, code.delete("-")[0, 4]
    end
  end

  def test_base_n_rejects_out_of_range
    codec = BaseHuman::Baseh.new(hex_profile)
    [-1, 65_536, 1_000_000].each do |id|
      error = assert_raises(BaseHuman::BasehError) { codec.encode(id: id) }
      assert_equal "OUT_OF_RANGE", error.code
    end
  end

  # --- boundary round trips (test-suite section 5) ---

  def test_capacity
    assert_equal 1_073_741_824, baseh32.capacity
    assert_equal 1_073_741_824, baseh32s.capacity
  end

  def test_boundary_round_trips
    [0, 1, 31, 32, 33, 1_073_741_822, 1_073_741_823].each do |id|
      [baseh32, baseh32s, noperm_codec].each do |codec|
        result = codec.decode(codec.encode(id: id))
        assert_equal id, result.id
        assert_equal codec.encode(id: id), result.canonical_code
      end
    end
  end

  def test_capacity_encode_rejected
    [baseh32, baseh32s].each do |codec|
      error = assert_raises(BaseHuman::BasehError) { codec.encode(id: 1_073_741_824) }
      assert_equal "OUT_OF_RANGE", error.code
    end
  end

  def test_encoder_never_emits_alias_sources
    1_000.times do |i|
      code = baseh32.encode(id: i * 997)
      refute_match(/[OIL]/, code)
    end
  end

  # --- normalization and aliases (test-suite sections 7-8) ---

  def test_lowercase_and_whitespace_decode
    code = baseh32.encode(id: 42)
    assert_equal 42, baseh32.decode(code.downcase).id
    assert_equal 42, baseh32.decode("  #{code}  ").id
    assert_equal 42, baseh32.decode("\t#{code}\n").id
  end

  def test_separator_chars_rejected_when_no_separator_configured
    code = baseh32.encode(id: 42)
    error = assert_raises(BaseHuman::BasehError) { baseh32.decode(code[0, 3] + "-" + code[3..]) }
    assert_equal "INVALID_CHARACTER", error.code
  end

  def test_alias_input_decodes
    # O maps to 0. id 0 encodes to body "000000" plus its checksum.
    raw_code = noperm_codec.encode(id: 0)
    assert_equal 0, noperm_codec.decode(raw_code.sub("0", "O")).id

    # I and L map to 1. Find an id whose body contains a canonical 1.
    id_of_one = BODY_ALPHABET.index("1") # body value with last digit 1 and rest 0
    raw_one = noperm_codec.encode(id: id_of_one)
    assert raw_one.include?("1")
    assert_equal id_of_one, noperm_codec.decode(raw_one.sub("1", "I")).id
    assert_equal id_of_one, noperm_codec.decode(raw_one.sub("1", "L")).id
    assert_equal id_of_one, noperm_codec.decode(raw_one.sub("1", "i")).id

    # Unknown alias source fails.
    error = assert_raises(BaseHuman::BasehError) { noperm_codec.decode("UUUUUUU") }
    assert_equal "INVALID_CHARACTER", error.code
  end

  def test_accept_spaces_option
    code = baseh32.encode(id: 7)
    spaced = code.chars.join(" ")
    assert_equal 7, baseh32.decode(spaced, accept_spaces: true).id
    error = assert_raises(BaseHuman::BasehError) { baseh32.decode(spaced) }
    assert_equal "INVALID_CHARACTER", error.code
  end

  def test_validate_never_raises_on_user_input
    ["", nil, 42, "@@@@", "0" * 100, "OIOIL01", "a b c"].each do |input|
      result = baseh32.validate(input)
      assert_includes [true, false], result.valid
      if result.valid
        refute_nil result.canonical_code
      else
        assert_includes BaseHuman::BasehError::CODES, result.reason
      end
    end
  end

  # --- checksum properties (test-suite section 6) ---

  def raw_body(codec, id)
    codec.encode(id: id)[0, codec.profile.body_length]
  end

  def test_checksum_deterministic
    body = raw_body(noperm_codec, 123_456)
    a = BaseHuman::Checksum.calculate_checksum(noperm_codec.profile, body)
    b = BaseHuman::Checksum.calculate_checksum(noperm_codec.profile, body)
    assert_equal a, b
  end

  def test_checksum_changes_with_body_symbol
    body_alphabet = noperm_codec.profile.body_alphabet
    body = raw_body(noperm_codec, 123_456)
    index = BaseHuman::BaseN.alphabet_index(body_alphabet)
    original = BaseHuman::Checksum.calculate_checksum(noperm_codec.profile, body)
    changed = body.dup
    changed[3] = body_alphabet[(index[body[3]] + 1) % 32]
    altered = BaseHuman::Checksum.calculate_checksum(noperm_codec.profile, changed)
    # baseh32 has known structured misses, so only check same-position swaps
    # with delta 1 (always detected since 1 is not a multiple of 26).
    refute_equal original, altered
  end

  def test_checksum_depends_on_profile_id
    other = noperm.merge(profile_id: "other-id")
    body = raw_body(noperm_codec, 99)
    a = BaseHuman::Checksum.calculate_checksum(noperm_codec.profile, body)
    b = BaseHuman::Checksum.calculate_checksum(BaseHuman::Baseh.new(other).profile, body)
    refute_equal a, b
  end

  def test_checksum_fixed_width
    100.times do |i|
      assert_equal 7, baseh32.encode(id: i * 1234).length
    end
    100.times do |i|
      assert_equal 8, baseh32s.encode(id: i * 1234).length
    end
  end

  # --- correction (test-suite section 9) ---

  def test_correction_light_finds_single_substitution
    # Find an id whose body ends in P, then swap the last body symbol to T.
    # P and T are a pair in the light confusion map.
    id = (0..1000).find { |i| noperm_codec.encode(id: i)[5] == "P" }
    raw_id = noperm_codec.encode(id: id)
    confused = raw_id[0, 5] + "T" + raw_id[6..]

    error = assert_raises(BaseHuman::BasehError) { noperm_codec.decode(confused) }
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
    error = assert_raises(BaseHuman::BasehError) do
      noperm_codec.decode(confused, try_correction: true, confusion_profile: :light)
    end
    assert_equal "INVALID_CHECKSUM", error.code
  end

  def test_correction_requires_flag
    error = assert_raises(BaseHuman::BasehError) { noperm_codec.decode("0000TBC") }
    assert_equal "INVALID_CHECKSUM", error.code
  end

  def test_candidate_cap
    map = Hash.new { |h, k| h[k] = (BODY_ALPHABET.chars - [k]).first(11) }
    error = assert_raises(BaseHuman::BasehError) do
      noperm_codec.generate_candidates("ABCDEF", map, 1)
    end
    assert_equal "TOO_MANY_CANDIDATES", error.code
  end

  def test_max_corrections_zero_disables_correction
    error = assert_raises(BaseHuman::BasehError) do
      noperm_codec.decode("0000TBC", try_correction: true,
                                      confusion_profile: :light, max_corrections: 0)
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
    codec = BaseHuman::Baseh.new(
      base_profile.merge(separator: "", grouping: [],
                         profanity: { mode: "blocklist", words: ["AAAA"] })
    )
    blocked_id = BaseHuman::BaseN.decode_base_n("AAAA00", BODY_ALPHABET)
    error = assert_raises(BaseHuman::BasehError) { codec.encode(id: blocked_id) }
    assert_equal "BLOCKED_CODE", error.code
    refute error.safe_for_customer
    # A neighbouring clean id encodes fine.
    assert codec.encode(id: blocked_id - 1)
  end

  def test_blocklist_default_list_applies_without_words
    codec = BaseHuman::Baseh.new(
      base_profile.merge(separator: "", grouping: [],
                         profile_id: "default-list", profanity: { mode: "blocklist" })
    )
    blocked_id = BaseHuman::BaseN.decode_base_n("DAMN00", BODY_ALPHABET)
    error = assert_raises(BaseHuman::BasehError) { codec.encode(id: blocked_id) }
    assert_equal "BLOCKED_CODE", error.code
  end

  def test_blocklist_extra_words_augment_default
    codec = BaseHuman::Baseh.new(
      base_profile.merge(separator: "", grouping: [],
                         profile_id: "extra-list",
                         profanity: { mode: "blocklist", extra_words: ["QQQQ"] })
    )
    blocked_id = BaseHuman::BaseN.decode_base_n("QQQQ00", BODY_ALPHABET)
    error = assert_raises(BaseHuman::BasehError) { codec.encode(id: blocked_id) }
    assert_equal "BLOCKED_CODE", error.code
    # The default list is still armed.
    damn_id = BaseHuman::BaseN.decode_base_n("DAMN00", BODY_ALPHABET)
    assert_equal "BLOCKED_CODE",
                 assert_raises(BaseHuman::BasehError) { codec.encode(id: damn_id) }.code
  end

  def test_blocklist_words_replace_default
    codec = BaseHuman::Baseh.new(
      base_profile.merge(separator: "", grouping: [],
                         profile_id: "replace-list",
                         profanity: { mode: "blocklist", words: ["ZZZZ"] })
    )
    zzzz_id = BaseHuman::BaseN.decode_base_n("ZZZZ00", BODY_ALPHABET)
    assert_equal "BLOCKED_CODE",
                 assert_raises(BaseHuman::BasehError) { codec.encode(id: zzzz_id) }.code
    # words replaces the default list, so DAMN now passes validation.
    damn_id = BaseHuman::BaseN.decode_base_n("DAMN00", BODY_ALPHABET)
    assert codec.encode(id: damn_id)
  end

  def test_blocklist_scan_includes_checksum_character
    codec = BaseHuman::Baseh.new(
      base_profile.merge(separator: "", grouping: [],
                         profile_id: "checksum-scan",
                         profanity: { mode: "blocklist", words: ["QQQ"] })
    )
    # Find an id whose raw code contains three Q symbols.
    hit = (0...1_000_000).find do |i|
      body = BaseHuman::BaseN.encode_base_n(i, BODY_ALPHABET, 6)
      checksum = BaseHuman::Checksum.calculate_checksum(codec.profile, body)
      (body + checksum).include?("QQQ")
    end
    assert hit, "expected to find a colliding id"
    assert_equal "BLOCKED_CODE",
                 assert_raises(BaseHuman::BasehError) { codec.encode(id: hit) }.code
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
    codec = BaseHuman::Baseh.new(sensitive)
    blocked_id = BaseHuman::BaseN.decode_base_n("damn00", "abcdefghijklmnopqrstuvwxyz0123456789")
    assert_equal "BLOCKED_CODE",
                 assert_raises(BaseHuman::BasehError) { codec.encode(id: blocked_id) }.code
  end

  def test_no_vowels_strips_alphabets_and_changes_capacity
    codec = BaseHuman::Baseh.new(
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
    codec = BaseHuman::Baseh.new(
      base_profile.merge(separator: "", grouping: [],
                         profanity: { mode: "no-vowels" })
    )
    error = assert_raises(BaseHuman::BasehError) { codec.decode("0000A02") }
    assert_equal "INVALID_CHARACTER", error.code
  end

  def test_no_vowels_alias_source_may_be_a_stripped_vowel
    # O, I and L are stripped vowels here (O and I are; L is consonant but
    # absent from the canonical alphabet). Aliases still accept them.
    codec = BaseHuman::Baseh.new(
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
      p = BaseHuman::Feistel.permute(i, capacity, **args)
      assert_operator p, :<, capacity
      refute seen[p]
      seen[p] = true
      assert_equal i, BaseHuman::Feistel.inverse_permute(p, capacity, **args)
    end
  end

  def test_feistel_key_and_profile_change_mapping
    capacity = 100_000
    a = BaseHuman::Feistel.permute(123, capacity,
                                   profile_id: "p1", key_bytes: TEST_KEY, rounds: 8)
    b = BaseHuman::Feistel.permute(123, capacity,
                                   profile_id: "p1", key_bytes: "other-key", rounds: 8)
    c = BaseHuman::Feistel.permute(123, capacity,
                                   profile_id: "p2", key_bytes: TEST_KEY, rounds: 8)
    refute_equal a, b
    refute_equal a, c
  end

  # --- smoke: sequential ids and fuzz ---

  def test_sequential_round_trip_smoke
    limit = ENV["SLOW"] == "1" ? 10_000 : 1_000
    limit.times do |id|
      assert_equal id, baseh32.decode(baseh32.encode(id: id)).id
    end
  end

  def test_fuzz_smoke_only_raises_baseh_error
    rng = Random.new(42)
    alphabet = (0x00..0x7f).map(&:chr)
    5_000.times do
      length = rng.rand(0..40)
      input = Array.new(length) { alphabet[rng.rand(alphabet.size)] }.join
      begin
        baseh32.decode(input)
      rescue BaseHuman::BasehError
        # expected category
      end
      # validate must never raise on user input
      result = baseh32.validate(input)
      assert_includes [true, false], result.valid
    end
    # Very long string must not hang or blow up.
    result = baseh32.validate("0" * 10_000)
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
      rescue BaseHuman::BasehError
        # expected category
      end
    end
  end

  def test_fuzz_no_vowels_profile_never_crashes
    rng = Random.new(42)
    codec = BaseHuman::Baseh.new(
      base_profile.merge(separator: "", grouping: [],
                         profanity: { mode: "no-vowels" })
    )
    chars = "AEIOU0123456789BCDFGHJKMNPQRSTVWXZ- "
    2_000.times do
      input = Array.new(rng.rand(0..10)) { chars.chars[rng.rand(chars.size)] }.join
      begin
        codec.decode(input)
      rescue BaseHuman::BasehError
        # expected category
      end
    end
  end
end
