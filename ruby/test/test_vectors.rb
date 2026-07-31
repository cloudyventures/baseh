# frozen_string_literal: true

require "json"
require "minitest/autorun"
require "base_human"

# Cross-language conformance vectors. vectors/ is the frozen contract and is
# shared with every other language implementation in this repo.
class TestVectors < Minitest::Test
  VECTORS_DIR = File.expand_path("../../vectors", __dir__)

  def self.load_json(name)
    JSON.parse(File.read(File.join(VECTORS_DIR, name)))
  end

  def self.vectors_doc
    @vectors_doc ||= load_json("vectors.json")
  end

  def self.feistel_doc
    @feistel_doc ||= load_json("feistel-vectors.json")
  end

  # Builds a Ruby profile hash from the embedded JS-style definition.
  # keyBytesHex becomes a binary String per the gem's API.
  def self.build_profile(definition)
    perm = definition["permutation"]
    permutation =
      if perm["enabled"]
        {
          enabled: true,
          algorithm: perm["algorithm"],
          key_id: perm["keyId"],
          key_bytes: [perm["keyBytesHex"]].pack("H*"),
          rounds: perm["rounds"]
        }
      else
        { enabled: false }
      end
    {
      profile_id: definition["profileId"],
      body_alphabet: definition["bodyAlphabet"],
      body_length: definition["bodyLength"],
      checksum_alphabet: definition["checksumAlphabet"],
      checksum_length: definition["checksumLength"],
      case_sensitive: definition["caseSensitive"],
      separator: definition["separator"],
      grouping: definition["grouping"],
      aliases: definition["aliases"] || {},
      permutation: permutation
    }
  end

  def codec(profile_id)
    @codecs ||= {}
    @codecs[profile_id] ||= begin
      definition = self.class.vectors_doc["profiles"]
                       .find { |p| p["profileId"] == profile_id }
      raise "unknown vector profile #{profile_id}" unless definition

      BaseHuman::Hrc.new(self.class.build_profile(definition["definition"]))
    end
  end

  def test_profile_capacities
    self.class.vectors_doc["profiles"].each do |entry|
      assert_equal entry["capacity"].to_i,
                   codec(entry["profileId"]).capacity,
                   "capacity mismatch for #{entry['profileId']}"
    end
  end

  def test_every_vector_profile_validates
    self.class.vectors_doc["profiles"].each do |entry|
      assert codec(entry["profileId"])
    end
  end

  def test_encode_vectors
    self.class.vectors_doc["vectors"].each do |vector|
      hrc = codec(vector["profileId"])
      code = hrc.encode(id: vector["id"].to_i)
      assert_equal vector["canonicalCode"], code,
                   "encode mismatch for #{vector['profileId']} id=#{vector['id']}"
    end
  end

  def test_decode_vectors
    self.class.vectors_doc["vectors"].each do |vector|
      hrc = codec(vector["profileId"])
      input = vector["input"] || vector["canonicalCode"]
      result = hrc.decode(input)
      assert_equal vector["id"].to_i, result.id,
                   "decode mismatch for #{vector['profileId']} input=#{input.inspect}"
      assert_equal vector["canonicalCode"], result.canonical_code
      refute result.corrected
    end
  end

  def test_formatting_round_trips
    self.class.vectors_doc["vectors"].each do |vector|
      next unless vector["rawBody"] && vector["rawChecksum"]

      hrc = codec(vector["profileId"])
      raw = vector["rawBody"] + vector["rawChecksum"]
      # Decoding the separator-free raw form must yield the same canonical code.
      result = hrc.decode(raw)
      assert_equal vector["canonicalCode"], result.canonical_code
    end
  end

  def test_error_vectors
    self.class.vectors_doc["errors"].each do |vector|
      hrc = codec(vector["profileId"])
      error = assert_raises(BaseHuman::HrcError,
                            "expected #{vector['error']} for #{vector['input'].inspect}") do
        hrc.decode(vector["input"])
      end
      assert_equal vector["error"], error.code,
                   "wrong code for input #{vector['input'].inspect}"
    end
  end

  def test_correction_vectors
    self.class.vectors_doc["correction"].each do |vector|
      hrc = codec(vector["profileId"])
      confusion = (vector["confusionProfile"] || "light").to_sym
      if vector["error"]
        error = assert_raises(BaseHuman::HrcError) do
          hrc.decode(vector["input"], try_correction: true, confusion_profile: confusion)
        end
        assert_equal vector["error"], error.code
      else
        result = hrc.decode(vector["input"],
                            try_correction: true, confusion_profile: confusion)
        expected_checksum = vector["input"].delete("-")[6..]
        raw = vector["expectedBody"] + expected_checksum
        assert_equal vector["expectedBody"],
                     result.canonical_code.delete("-")[0...6],
                     "corrected body mismatch for #{vector['input'].inspect}"
        assert_equal true, result.corrected
        assert_equal raw, result.canonical_code.delete("-")
      end
    end
  end

  def test_feistel_vectors
    self.class.feistel_doc["vectors"].each do |vector|
      key = {
        profile_id: vector["profileId"],
        key_bytes: [vector["keyBytesHex"]].pack("H*"),
        rounds: vector["rounds"]
      }
      capacity = vector["capacity"].to_i
      input = vector["input"].to_i
      expected = vector["permuted"].to_i

      permuted = BaseHuman::Feistel.permute(input, capacity, **key)
      assert_equal expected, permuted,
                   "permute mismatch: #{vector.inspect}"

      back = BaseHuman::Feistel.inverse_permute(permuted, capacity, **key)
      assert_equal input, back,
                   "inverse mismatch: #{vector.inspect}"
    end
  end

  def test_feistel_inverse_of_every_vector_input
    self.class.feistel_doc["vectors"].each do |vector|
      key = {
        profile_id: vector["profileId"],
        key_bytes: [vector["keyBytesHex"]].pack("H*"),
        rounds: vector["rounds"]
      }
      capacity = vector["capacity"].to_i
      input = vector["input"].to_i

      permuted = BaseHuman::Feistel.permute(input, capacity, **key)
      assert_operator permuted, :<, capacity
      assert_equal input, BaseHuman::Feistel.inverse_permute(permuted, capacity, **key)
    end
  end
end
