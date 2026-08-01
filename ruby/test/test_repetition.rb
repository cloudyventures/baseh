# frozen_string_literal: true

require "minitest/autorun"
require "baseh"

# Repetition filter tests (spec 21), mirroring js/test/repetition.test.ts.
class TestRepetition < Minitest::Test
  TEST_KEY = ["746573742d6f6e6c792d6b65792d6d6174657269616c2d30303031"].pack("H*")
  ALPHA32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

  def alpha32(overrides = {})
    {
      profile_id: "rep-test",
      body_alphabet: ALPHA32,
      body_length: 6,
      checksum_alphabet: "234679ACDEFGHJKMNPQRTUVWXY",
      checksum_length: 1,
      case_sensitive: false,
      separator: "",
      grouping: [],
      aliases: { "O" => "0", "I" => "1", "L" => "1" },
      permutation: { enabled: false }
    }.merge(overrides)
  end

  def max_run(raw)
    best = 1
    run = 1
    (1...raw.length).each do |i|
      run = raw[i] == raw[i - 1] ? run + 1 : 1
      best = run if run > best
    end
    best
  end

  # First id whose raw code (per a filter-free twin) has max run exactly n.
  def find_id_with_run(profile, n, limit = 5_000_000)
    twin = Baseh::Baseh.new(profile.merge(max_repetition: 0, profanity: { mode: "none" }))
    (0...limit).each do |id|
      return id if max_run(twin.encode(id: id).delete("-")) == n
    end
    raise "no id with max run #{n} below #{limit}"
  end

  def assert_blocked
    error = assert_raises(Baseh::BasehError) { yield }
    assert_equal "BLOCKED_CODE", error.code
  end

  # --- validation (spec 21) ---

  def test_rejects_1_and_2_accepts_0_and_3
    [1, 2].each do |bad|
      error = assert_raises(Baseh::BasehError) do
        Baseh::Profile.prepare(alpha32(max_repetition: bad))
      end
      assert_equal "INVALID_PROFILE", error.code
    end
    assert_equal 0, Baseh::Profile.prepare(alpha32(max_repetition: 0)).max_repetition
    assert_equal 3, Baseh::Profile.prepare(alpha32(max_repetition: 3)).max_repetition
    # A value above the code length is a legal no-op.
    assert_equal 99, Baseh::Profile.prepare(alpha32(max_repetition: 99)).max_repetition
  end

  def test_defaults_to_zero
    assert_equal 0, Baseh::Profile.prepare(alpha32).max_repetition
  end

  # --- encode (spec 21) ---

  def profile
    alpha32(max_repetition: 4)
  end

  def codec
    @codec ||= Baseh::Baseh.new(profile)
  end

  def test_blocks_a_run_of_exactly_4
    assert_blocked { codec.encode(id: find_id_with_run(profile, 4)) }
  end

  def test_allows_a_run_of_exactly_3
    id = find_id_with_run(profile, 3)
    assert_equal id, codec.decode(codec.encode(id: id)).id
  end

  def test_off_at_zero
    off = Baseh::Baseh.new(alpha32(max_repetition: 0))
    id = find_id_with_run(profile, 4)
    assert_equal id, off.decode(off.encode(id: id)).id
  end

  def test_custom_max_repetition_3_blocks_triples
    three = alpha32(max_repetition: 3)
    assert_blocked { Baseh::Baseh.new(three).encode(id: find_id_with_run(three, 3)) }
  end

  def test_separators_do_not_break_a_run
    # body "AAAA" renders AA-AA...: no formatted group shows a run of 4, but
    # the raw code is AAAA + checksum, a run of 4, so the filter fires.
    sep = {
      profile_id: "rep-sep-test",
      body_alphabet: "0123456789ABCDEF",
      body_length: 4,
      checksum_alphabet: "234679ACDEFGHJKMNPQRTUVWXY",
      checksum_length: 1,
      case_sensitive: false,
      separator: "-",
      grouping: [2, 2, 1],
      aliases: {},
      permutation: { enabled: false },
      max_repetition: 4
    }
    id = 10 * 16**3 + 10 * 16**2 + 10 * 16 + 10 # body AAAA
    twin = Baseh::Baseh.new(sep.merge(max_repetition: 0))
    assert_match(/^AA-AA/, twin.encode(id: id))
    assert_blocked { Baseh::Baseh.new(sep).encode(id: id) }
  end

  def test_issuance_skips_a_blocked_id_by_advancing
    id = find_id_with_run(profile, 4)
    code = nil
    until code
      begin
        code = codec.encode(id: id)
      rescue Baseh::BasehError => e
        assert_equal "BLOCKED_CODE", e.code
        id += 1
      end
    end
    assert_equal id, codec.decode(code).id
  end

  # --- decode (spec 21.3) ---

  def test_decode_reports_blocked_code_for_a_code_that_could_never_be_issued
    twin = Baseh::Baseh.new(alpha32(max_repetition: 0))
    code = twin.encode(id: find_id_with_run(profile, 4))
    assert_blocked { codec.decode(code) }
  end

  def test_correction_never_corrects_into_a_blocked_code
    # "00BBBB" is one light-confusion flip (D->B) from the presented body
    # "00DBBB"; the sole checksum-matching candidate carries a run of 4, so
    # decode surfaces BLOCKED_CODE instead of returning the corrected code.
    prepared = Baseh::Profile.prepare(alpha32)
    check = Baseh::Checksum.calculate_checksum(prepared, "00BBBB")
    assert_blocked do
      codec.decode("00DBBB#{check}", try_correction: true, confusion_profile: :light)
    end
  end

  # --- frozen tiers ship maxRepetition 4 (spec 21.4) ---

  FROZEN_TIERS = [
    ["baseh-minimum-v1", -> { Baseh.baseh_minimum_v1 }],
    ["baseh-light-v1", -> { Baseh.baseh_light_v1 }],
    ["baseh-medium-v1", -> { Baseh.baseh_medium_v1 }],
    ["baseh-heavy-v1", -> { Baseh.baseh_heavy_v1 }],
    ["baseh-minimum-p-v1", -> { Baseh.baseh_minimum_p_v1(key_bytes: TEST_KEY) }],
    ["baseh-light-p-v1", -> { Baseh.baseh_light_p_v1(key_bytes: TEST_KEY) }],
    ["baseh-medium-p-v1", -> { Baseh.baseh_medium_p_v1(key_bytes: TEST_KEY) }],
    ["baseh-heavy-p-v1", -> { Baseh.baseh_heavy_p_v1(key_bytes: TEST_KEY) }],
    ["baseh-expandable-v1", -> { Baseh.baseh_expandable_v1 }],
    ["baseh-expandable-p-v1", -> { Baseh.baseh_expandable_p_v1(key_bytes: TEST_KEY) }]
  ].freeze

  def test_frozen_tiers_block_a_doctored_4_run_id
    FROZEN_TIERS.each do |name, build|
      profile = build.call
      assert_equal 4, Baseh::Profile.prepare(profile).max_repetition, name
      h = Baseh::Baseh.new(profile)
      assert_blocked { h.encode(id: find_id_with_run(profile, 4)) }
    end
  end
end
