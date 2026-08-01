# frozen_string_literal: true

require "minitest/autorun"
require "baseh"

# Cross-language round-trip soak suite (spec/IMPLEMENTATION_SOAK_TESTS.md).
#
# Every shipped tier, keyed (-p) variants included, in two variants —
# permutation ON (as shipped) and permutation OFF (test-only twin, built the
# same way the repetition tests build filter-free twins: profile.merge with
# permutation disabled; for the expandable tier the single permutation block
# applies across all generations, so disabling it covers every generation).
#
# Two run levels:
#   * CI subset (default test run): sweep capped at CI_SWEEP_CAP ids per
#     profile, CI_RANDOM_COUNT random samples.
#   * Full soak: BASEH_SOAK=1 selects the full bounds of the spec (random
#     count overridable via BASEH_SOAK_RANDOM, default 1_000_000; sweep
#     overridable via BASEH_SOAK_SWEEP for smoke runs). Without BASEH_SOAK
#     the soak-level tests skip cleanly.
class TestSoak < Minitest::Test
  SOAK_KEY = ["00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"].pack("H*")
  SOAK_KEY_ID = "soak-test"
  SEED = 42
  RANDOM_LOW = 1_000_000_000
  RANDOM_HIGH = 100_000_000_000

  CI_SWEEP_CAP = 100_000
  CI_RANDOM_COUNT = 10_000

  def soak?
    ENV["BASEH_SOAK"] == "1"
  end

  def soak_sweep_override
    ENV["BASEH_SOAK_SWEEP"]&.to_i
  end

  def soak_random_count
    (ENV["BASEH_SOAK_RANDOM"] || 1_000_000).to_i
  end

  # [profile_id, builder] for every shipped tier, plain and keyed.
  def shipped_profiles
    [
      ["baseh-minimum-v1", -> { Baseh.baseh_minimum_v1 }],
      ["baseh-minimum-p-v1", -> { Baseh.baseh_minimum_p_v1(key_bytes: SOAK_KEY, key_id: SOAK_KEY_ID) }],
      ["baseh-light-v1", -> { Baseh.baseh_light_v1 }],
      ["baseh-light-p-v1", -> { Baseh.baseh_light_p_v1(key_bytes: SOAK_KEY, key_id: SOAK_KEY_ID) }],
      ["baseh-medium-v1", -> { Baseh.baseh_medium_v1 }],
      ["baseh-medium-p-v1", -> { Baseh.baseh_medium_p_v1(key_bytes: SOAK_KEY, key_id: SOAK_KEY_ID) }],
      ["baseh-heavy-v1", -> { Baseh.baseh_heavy_v1 }],
      ["baseh-heavy-p-v1", -> { Baseh.baseh_heavy_p_v1(key_bytes: SOAK_KEY, key_id: SOAK_KEY_ID) }],
      ["baseh-expandable-v1", -> { Baseh.baseh_expandable_v1 }],
      ["baseh-expandable-p-v1", -> { Baseh.baseh_expandable_p_v1(key_bytes: SOAK_KEY, key_id: SOAK_KEY_ID) }]
    ]
  end

  # Spec section 3: sweep to min(1e9, capacity). Fixed tiers report their
  # prepared capacity; the expandable tier sweeps to 1e9.
  def sweep_bound(profile)
    codec = Baseh::Baseh.new(profile)
    if profile[:mode] == "expandable"
      1_000_000_000
    else
      [1_000_000_000, codec.capacity].min
    end
  end

  def variants(profile)
    [
      ["permutation-on", profile],
      ["permutation-off", profile.merge(permutation: { enabled: false })]
    ]
  end

  def run_sweep(cap)
    shipped_profiles.each do |name, build|
      profile = build.call
      bound = [sweep_bound(profile), cap].min
      variants(profile).each do |variant, twin|
        codec = Baseh::Baseh.new(twin)
        checked = 0
        blocked = 0
        started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        (0...bound).each do |id|
          code = begin
            codec.encode(id: id)
          rescue Baseh::BasehError => e
            raise unless e.code == "BLOCKED_CODE"

            blocked += 1
            next
          end
          decoded = codec.decode(code).id
          unless decoded == id
            flunk("soak mismatch: profile=#{name} variant=#{variant} phase=sweep " \
                  "id=#{id} code=#{code} stage=decode decoded=#{decoded}")
          end
          checked += 1
        rescue Baseh::BasehError => e
          flunk("soak error: profile=#{name} variant=#{variant} phase=sweep " \
                "id=#{id} code=#{code.inspect} stage=round-trip error=#{e.code}: #{e.message}")
        end
        elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
        rate = elapsed.positive? ? ((checked + blocked) / elapsed).round : 0
        puts(format("soak sweep profile=%s variant=%s checked=%d blocked=%d elapsed=%.2fs throughput=%d ids/s",
                    name, variant, checked, blocked, elapsed, rate))
      end
    end
  end

  def run_random(count)
    rng = Random.new(SEED)
    puts("soak random seed=#{SEED} count=#{count} range=[#{RANDOM_LOW}, #{RANDOM_HIGH})")
    shipped_profiles.select { |name, _| name.start_with?("baseh-expandable") }.each do |name, build|
      profile = build.call
      variants(profile).each do |variant, twin|
        codec = Baseh::Baseh.new(twin)
        checked = 0
        blocked = 0
        started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        count.times do
          id = rng.rand(RANDOM_LOW...RANDOM_HIGH)
          code = begin
            codec.encode(id: id)
          rescue Baseh::BasehError => e
            raise unless e.code == "BLOCKED_CODE"

            blocked += 1
            next
          end
          decoded = codec.decode(code).id
          unless decoded == id
            flunk("soak mismatch: profile=#{name} variant=#{variant} phase=random " \
                  "seed=#{SEED} id=#{id} code=#{code} stage=decode decoded=#{decoded}")
          end
          checked += 1
        rescue Baseh::BasehError => e
          flunk("soak error: profile=#{name} variant=#{variant} phase=random " \
                "seed=#{SEED} id=#{id} code=#{code.inspect} stage=round-trip error=#{e.code}: #{e.message}")
        end
        elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
        rate = elapsed.positive? ? ((checked + blocked) / elapsed).round : 0
        puts(format("soak random profile=%s variant=%s seed=%d checked=%d blocked=%d elapsed=%.2fs throughput=%d ids/s",
                    name, variant, SEED, checked, blocked, elapsed, rate))
      end
    end
  end

  # CI subset: always runs, must finish in seconds.
  def test_sweep_round_trip_ci_subset
    run_sweep(CI_SWEEP_CAP)
  end

  def test_random_round_trip_ci_subset
    run_random(CI_RANDOM_COUNT)
  end

  # Full soak: opt-in via BASEH_SOAK=1 (the minitest long-test idiom: a clean
  # skip when the env var is absent).
  def test_sweep_round_trip_soak
    skip "full soak: set BASEH_SOAK=1 to run" unless soak?

    cap = soak_sweep_override || 1_000_000_000
    run_sweep(cap)
  end

  def test_random_round_trip_soak
    skip "full soak: set BASEH_SOAK=1 to run" unless soak?

    run_random(soak_random_count)
  end
end
