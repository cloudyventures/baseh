# frozen_string_literal: true

require_relative "lib/baseh/version"

Gem::Specification.new do |spec|
  spec.name          = "baseh"
  spec.version       = Baseh::VERSION
  spec.authors       = ["cloudyventures"]
  spec.summary       = "baseH (Human Reference Code) codec, Ruby port of the frozen spec"
  spec.description   = "Encodes and decodes human reference codes per the baseH codec " \
                       "specification: fixed-length base-N bodies, rolling polynomial " \
                       "checksums, optional feistel-v1 permutation, spoken-confusion " \
                       "correction and profanity safety."
  spec.license       = "AGPL-3.0"
  spec.required_ruby_version = ">= 3.0"
  spec.files         = Dir["lib/**/*.rb"] + ["README.md"]
  spec.require_paths = ["lib"]
  spec.add_development_dependency "rake", "~> 13.0"
  # Zero runtime dependencies. openssl, json and minitest are stdlib.
  spec.metadata = {
    "rubygems_mfa_required" => "true"
  }
end
