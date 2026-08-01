# frozen_string_literal: true

require "minitest/autorun"
require "baseh"

# Single-substitution checksum detection sweep, spec/IMPLEMENTATION_TEST_SUITE.md
# section 6. For each checksummed frozen tier (Light, Medium and Heavy) every
# single-symbol substitution of a sampled body must change the checksum:
# zero misses, per spec 6.3.
#
# Two run levels, same idiom as test_soak.rb:
#   * CI subset (default test run): CI_BODY_COUNT sampled bodies per tier.
#   * Full sweep: BASEH_SOAK=1 runs the spec's 100,000 sampled bodies per
#     tier (overridable via BASEH_SOAK_BODIES). Without BASEH_SOAK the
#     soak-level test skips cleanly.
class TestChecksumSweep < Minitest::Test
  SEED = 42

  CI_BODY_COUNT = 500
  SOAK_BODY_COUNT = 100_000

  def soak?
    ENV["BASEH_SOAK"] == "1"
  end

  def soak_body_count
    (ENV["BASEH_SOAK_BODIES"] || SOAK_BODY_COUNT).to_i
  end

  def checksummed_tiers
    [
      ["baseh-light-v1", Baseh.baseh_light_v1],
      ["baseh-medium-v1", Baseh.baseh_medium_v1],
      ["baseh-heavy-v1", Baseh.baseh_heavy_v1]
    ]
  end

  # Sweeps `count` seeded random bodies; returns the miss count (substitutions
  # whose checksum did not change).
  def sweep(profile, count)
    codec = Baseh::Baseh.new(profile)
    prepared = codec.profile
    index = Baseh::BaseN.alphabet_index(prepared.body_alphabet)
    alphabet = prepared.body_alphabet.chars
    rng = Random.new(SEED)
    misses = 0
    count.times do
      body = Array.new(prepared.body_length) { alphabet[rng.rand(alphabet.size)] }.join
      expected = Baseh::Checksum.calculate_checksum(prepared, body, index)
      chars = body.chars
      chars.each_index do |pos|
        alphabet.each do |replacement|
          next if replacement == chars[pos]

          candidate = chars.dup
          candidate[pos] = replacement
          substituted = Baseh::Checksum.calculate_checksum(prepared, candidate.join, index)
          misses += 1 if substituted == expected
        end
      end
    end
    misses
  end

  def run_sweep(count)
    checksummed_tiers.each do |name, profile|
      misses = sweep(profile, count)
      assert_equal 0, misses,
                   "#{name}: #{misses} single substitutions went undetected " \
                   "over #{count} sampled bodies (spec 6.3 requires zero)"
    end
  end

  # CI subset: always runs, must finish in seconds.
  def test_single_substitution_sweep_ci_subset
    run_sweep(CI_BODY_COUNT)
  end

  # Full 100,000-body sweep of test-suite section 6: opt-in via BASEH_SOAK=1.
  def test_single_substitution_sweep_soak
    skip "full checksum sweep: set BASEH_SOAK=1 to run" unless soak?

    run_sweep(soak_body_count)
  end
end
