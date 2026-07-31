# frozen_string_literal: true

require "minitest/autorun"
require "base_human"

# Codec unit tests: profile validation, boundary round trips, correction,
# checksum properties, sequential smoke and a deterministic fuzz smoke.
class TestCodec < Minitest::Test
  TEST_KEY = ["746573742d6f6e6c792d6b65792d6d6174657269616c2d30303031"].pack("H*")

  def hrc32
    @hrc32 ||= BaseHuman::Hrc.new(BaseHuman.hrc32_v1(key_bytes: TEST_KEY, key_id: "test-01"))
  end

  def hrc32s
    @hrc32s ||= BaseHuman::Hrc.new(BaseHuman.hrc32s_v1(key_bytes: TEST_KEY, key_id: "test-01"))
  end

  def noperm
    @noperm ||= BaseHuman.hrc32_v1(key_bytes: TEST_KEY, key_id: "test-01")
                         .merge(profile_id: "hrc32-noperm-test",
                                permutation: { enabled: false })
  end

  def noperm_codec
    @noperm_codec ||= BaseHuman::Hrc.new(noperm)
  end

  # --- profile validation (spec 2.2) ---

  def assert_invalid_profile(profile)
    error = assert_raises(BaseHuman::HrcError) { BaseHuman::Hrc.new(profile) }
    assert_equal "INVALID_PROFILE", error.code
  end

  def base_profile
    {
      profile_id: "unit-test",
      body_alphabet: "0123456789ABCDEFGHJKMNPQRSTVWXYZ",
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
    assert_invalid_profile(base_profile.merge(profile_id: "hrc\xC3\xA9".encode("UTF-8")))
  end

  def test_rejects_tiny_body_alphabet
    assert_invalid_profile(base_profile.merge(body_alphabet: "A"))
  end

  def test_rejects_duplicate_body_symbols
    assert_invalid_profile(base_profile.merge(body_alphabet: "0123ABC0A".dup + "DEFGHJKMNPQRSTVWX"))
  end

  def test_rejects_case_collision_in_body
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".sub("H", "h").sub("E", "e")
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
    assert BaseHuman::Hrc.new(BaseHuman.hrc32_v1(key_bytes: TEST_KEY, key_id: "k"))
    assert BaseHuman::Hrc.new(BaseHuman.hrc32s_v1(key_bytes: TEST_KEY, key_id: "k"))
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
    hrc = BaseHuman::Hrc.new(hex_profile)
    {
      0 => "0000", 1 => "0001", 15 => "000F", 16 => "0010",
      255 => "00FF", 256 => "0100", 65_535 => "FFFF"
    }.each do |id, body|
      code = hrc.encode(id: id)
      assert_equal body, code.delete("-")[0, 4]
    end
  end

  def test_base_n_rejects_out_of_range
    hrc = BaseHuman::Hrc.new(hex_profile)
    [-1, 65_536, 1_000_000].each do |id|
      error = assert_raises(BaseHuman::HrcError) { hrc.encode(id: id) }
      assert_equal "OUT_OF_RANGE", error.code
    end
  end

  # --- boundary round trips (test-suite section 5) ---

  def test_capacity
    assert_equal 1_073_741_824, hrc32.capacity
    assert_equal 1_073_741_824, hrc32s.capacity
  end

  def test_boundary_round_trips
    [0, 1, 31, 32, 33, 1_073_741_822, 1_073_741_823].each do |id|
      [hrc32, hrc32s, noperm_codec].each do |codec|
        result = codec.decode(codec.encode(id: id))
        assert_equal id, result.id
        assert_equal codec.encode(id: id), result.canonical_code
      end
    end
  end

  def test_capacity_encode_rejected
    [hrc32, hrc32s].each do |codec|
      error = assert_raises(BaseHuman::HrcError) { codec.encode(id: 1_073_741_824) }
      assert_equal "OUT_OF_RANGE", error.code
    end
  end

  def test_encoder_never_emits_alias_sources
    1_000.times do |i|
      code = hrc32.encode(id: i * 997)
      refute_match(/[OIL]/, code.delete("-"))
    end
  end

  # --- normalization and aliases (test-suite sections 7-8) ---

  def test_lowercase_and_separators_decode
    code = hrc32.encode(id: 42)
    assert_equal 42, hrc32.decode(code.downcase).id
    assert_equal 42, hrc32.decode(code.delete("-")).id
    assert_equal 42, hrc32.decode("  #{code}  ").id
    assert_equal 42, hrc32.decode("\t#{code}\n").id
  end

  def test_alias_input_decodes
    # O maps to 0. id 0 encodes to body "000000" plus its checksum.
    code = noperm_codec.encode(id: 0)
    raw_code = code.delete("-")
    assert_equal 0, noperm_codec.decode(raw_code.sub("0", "O")).id

    # I and L map to 1. Find an id whose body contains a canonical 1.
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    id_of_one = alphabet.index("1") # body value with last digit 1 and rest 0
    raw_one = noperm_codec.encode(id: id_of_one).delete("-")
    assert raw_one.include?("1")
    assert_equal id_of_one, noperm_codec.decode(raw_one.sub("1", "I")).id
    assert_equal id_of_one, noperm_codec.decode(raw_one.sub("1", "L")).id
    assert_equal id_of_one, noperm_codec.decode(raw_one.sub("1", "i")).id

    # Unknown alias source fails.
    error = assert_raises(BaseHuman::HrcError) { noperm_codec.decode("UUUUUUU") }
    assert_equal "INVALID_CHARACTER", error.code
  end

  def test_accept_spaces_option
    code = hrc32.encode(id: 7)
    spaced = code.gsub("-", " - ")
    assert_equal 7, hrc32.decode(spaced, accept_spaces: true).id
    error = assert_raises(BaseHuman::HrcError) { hrc32.decode(spaced) }
    assert_equal "INVALID_CHARACTER", error.code
  end

  def test_validate_never_raises_on_user_input
    ["", nil, 42, "@@@@", "0" * 100, "OIOIL0-1", "a b c"].each do |input|
      result = hrc32.validate(input)
      assert_includes [true, false], result.valid
      if result.valid
        refute_nil result.canonical_code
      else
        assert_includes BaseHuman::HrcError::CODES, result.reason
      end
    end
  end

  # --- checksum properties (test-suite section 6) ---

  def raw_body(codec, id)
    codec.encode(id: id).delete("-")[0, codec.profile.body_length]
  end

  def test_checksum_deterministic
    body = raw_body(noperm_codec, 123_456)
    a = BaseHuman::Checksum.calculate_checksum(noperm_codec.profile, body)
    b = BaseHuman::Checksum.calculate_checksum(noperm_codec.profile, body)
    assert_equal a, b
  end

  def test_checksum_changes_with_body_symbol
    body = raw_body(noperm_codec, 123_456)
    index = BaseHuman::BaseN.alphabet_index(noperm_codec.body_alphabet)
    original = BaseHuman::Checksum.calculate_checksum(noperm_codec.profile, body)
    changed = body.dup
    changed[3] = noperm_codec.body_alphabet[(index[body[3]] + 1) % 32]
    altered = BaseHuman::Checksum.calculate_checksum(noperm_codec.profile, changed)
    # hrc32 has known structured misses, so only check same-position swaps
    # with delta 1 (always detected since 1 is not a multiple of 26).
    refute_equal original, altered
  end

  def test_checksum_depends_on_profile_id
    other = noperm.merge(profile_id: "other-id")
    body = raw_body(noperm_codec, 99)
    a = BaseHuman::Checksum.calculate_checksum(noperm_codec.profile, body)
    b = BaseHuman::Checksum.calculate_checksum(BaseHuman::Hrc.new(other).profile, body)
    refute_equal a, b
  end

  def test_checksum_fixed_width
    100.times do |i|
      code = hrc32.encode(id: i * 1234)
      assert_equal 7, code.delete("-").length
    end
    100.times do |i|
      code = hrc32s.encode(id: i * 1234)
      assert_equal 8, code.delete("-").length
    end
  end

  # --- correction (test-suite section 9) ---

  def test_correction_light_finds_single_substitution
    # Find an id whose body ends in P, then swap the last body symbol to T.
    # P and T are a pair in the light confusion map.
    id = (0..1000).find { |i| noperm_codec.encode(id: i).delete("-")[5] == "P" }
    raw_id = noperm_codec.encode(id: id).delete("-")
    confused = raw_id[0, 5] + "T" + raw_id[6..]

    error = assert_raises(BaseHuman::HrcError) { noperm_codec.decode(confused) }
    assert_equal "INVALID_CHECKSUM", error.code

    result = noperm_codec.decode(confused, try_correction: true, confusion_profile: :light)
    assert_equal id, result.id
    assert result.corrected
    assert_equal noperm_codec.encode(id: id), result.canonical_code
  end

  def test_correction_no_result_raises_invalid_checksum
    # K is a valid body symbol but not a source in the light confusion map,
    # so no candidate can restore the checksum.
    raw = noperm_codec.encode(id: 0).delete("-")
    confused = "K" + raw[1..]
    error = assert_raises(BaseHuman::HrcError) do
      noperm_codec.decode(confused, try_correction: true, confusion_profile: :light)
    end
    assert_equal "INVALID_CHECKSUM", error.code
  end

  def test_correction_requires_flag
    error = assert_raises(BaseHuman::HrcError) { noperm_codec.decode("0000TBJ") }
    assert_equal "INVALID_CHECKSUM", error.code
  end

  def test_candidate_cap
    map = Hash.new { |h, k| h[k] = ("0123456789ABCDEFGHJKMNPQRSTVWXYZ".chars - [k]).first(11) }
    error = assert_raises(BaseHuman::HrcError) do
      noperm_codec.generate_candidates("ABCDEF", map, 1)
    end
    assert_equal "TOO_MANY_CANDIDATES", error.code
  end

  def test_max_corrections_zero_disables_correction
    error = assert_raises(BaseHuman::HrcError) do
      noperm_codec.decode("0000TBJ", try_correction: true,
                                      confusion_profile: :light, max_corrections: 0)
    end
    assert_equal "INVALID_CHECKSUM", error.code
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
      assert_equal id, hrc32.decode(hrc32.encode(id: id)).id
    end
  end

  def test_fuzz_smoke_only_raises_hrc_error
    rng = Random.new(42)
    alphabet = (0x00..0x7f).map(&:chr)
    5_000.times do
      length = rng.rand(0..40)
      input = Array.new(length) { alphabet[rng.rand(alphabet.size)] }.join
      begin
        hrc32.decode(input)
      rescue BaseHuman::HrcError
        # expected category
      end
      # validate must never raise on user input
      result = hrc32.validate(input)
      assert_includes [true, false], result.valid
    end
    # Very long string must not hang or blow up.
    result = hrc32.validate("0" * 10_000)
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
      rescue BaseHuman::HrcError
        # expected category
      end
    end
  end
end
