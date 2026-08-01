# frozen_string_literal: true

require "minitest/autorun"
require "baseh"

# Seeded property-style round-trip invariants (test-suite section 9), no
# property framework: a fixed-seed RNG samples ids across every shipped tier
# and asserts the invariants that must hold for any valid id.
class TestProperty < Minitest::Test
  SEED = 42
  SAMPLES = 200

  def codecs
    @codecs ||= {
      "baseh-minimum-v1" => Baseh::Baseh.new(Baseh.baseh_minimum_v1),
      "baseh-light-v1" => Baseh::Baseh.new(Baseh.baseh_light_v1),
      "baseh-medium-v1" => Baseh::Baseh.new(Baseh.baseh_medium_v1),
      "baseh-heavy-v1" => Baseh::Baseh.new(Baseh.baseh_heavy_v1),
      "baseh-expandable-v1" => Baseh::Baseh.new(Baseh.baseh_expandable_v1)
    }
  end

  def sample_id(codec, rng)
    if codec.profile.mode == "expandable"
      rng.rand(0...1_000_000_000)
    else
      rng.rand(0...codec.capacity)
    end
  end

  def test_seeded_round_trip_invariants
    rng = Random.new(SEED)
    codecs.each do |name, codec|
      checked = 0
      attempts = 0
      while checked < SAMPLES
        attempts += 1
        assert_operator attempts, :<, SAMPLES * 20,
                        "#{name}: too many blocklisted samples"
        id = sample_id(codec, rng)
        code = begin
          codec.encode(id: id)
        rescue Baseh::BasehError => e
          raise unless e.code == "BLOCKED_CODE"

          next # blocklisted ids are reserved, never issued (spec 18)
        end

        # Round trip: decode recovers the id and the canonical form is the
        # issued code with no correction.
        result = codec.decode(code)
        assert_equal id, result.id, "#{name} id=#{id}"
        assert_equal code, result.canonical_code, "#{name} id=#{id}"
        refute result.corrected, "#{name} id=#{id}"

        # Encoding the decoded id reproduces the same canonical code.
        assert_equal code, codec.encode(id: result.id), "#{name} id=#{id}"

        # Case-insensitive profiles accept the downcased code as the same id.
        unless codec.profile.case_sensitive
          downcased = codec.decode(code.downcase)
          assert_equal id, downcased.id, "#{name} id=#{id}"
          assert_equal code, downcased.canonical_code, "#{name} id=#{id}"
        end

        # validate agrees with decode.
        assert codec.validate(code).valid, "#{name} id=#{id}"

        checked += 1
      end
    end
  end
end
