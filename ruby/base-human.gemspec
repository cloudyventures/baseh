# frozen_string_literal: true

require_relative "lib/base_human/version"

Gem::Specification.new do |spec|
  spec.name          = "base-human"
  spec.version       = BaseHuman::VERSION
  spec.authors       = ["BaseHuman"]
  spec.summary       = "HRC (Human Reference Code) codec, Ruby port of the frozen spec"
  spec.description   = "Encodes and decodes human reference codes per the HRC codec " \
                       "specification: fixed-length base-N bodies, rolling polynomial " \
                       "checksums, optional feistel-v1 permutation and spoken-confusion " \
                       "correction."
  spec.license       = "MIT"
  spec.required_ruby_version = ">= 3.0"
  spec.files         = Dir["lib/**/*.rb"] + ["README.md"]
  spec.require_paths = ["lib"]
  # Zero runtime dependencies. openssl, json and minitest are stdlib.
  spec.metadata = {
    "rubygems_mfa_required" => "true"
  }
end
