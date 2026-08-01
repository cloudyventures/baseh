# frozen_string_literal: true

# Runnable examples for the baseh Ruby gem.
# Run from ruby/:  ruby -I lib examples/examples.rb

require "baseh"

def show(label)
  puts "#{label} -> #{yield.inspect}"
rescue Baseh::BasehError => e
  puts "#{label} -> raises BasehError [#{e.code}]: #{e.message}"
end

# 1. Zero configuration: the default Medium tier behind two functions.
puts "== zero config =="
show("Baseh.to_code(123456789)") { Baseh.to_code(123456789) }
show('Baseh.to_code("123456789")') { Baseh.to_code("123456789") }
show('Baseh.from_code("C8XP-8J49")') { Baseh.from_code("C8XP-8J49") }
show('Baseh.from_code("c8xp 8j49")') { Baseh.from_code("c8xp 8j49") }
show('Baseh.from_code("C8XP-8J4X")') { Baseh.from_code("C8XP-8J4X") }
show("Baseh.to_code(481890304)") { Baseh.to_code(481890304) }

# 2. A frozen preset: load baseh-medium-v1 and use the full codec.
puts "== preset =="
medium = Baseh::Baseh.new(Baseh.baseh_medium_v1)
show("encode(id: 123456789)") { medium.encode(id: 123456789) }
show('decode("C8XP-8J49").id') { medium.decode("C8XP-8J49").id }
show('decode("UORY-PDCA").id (typed aliases)') { medium.decode("UORY-PDCA").id }
show("encode(id: 813) (blocked word)") { medium.encode(id: 813) }
show('decode("C8XP-8J4X") (checksum typo)') { medium.decode("C8XP-8J4X").id }
show("capacity") { medium.capacity }

# 3. Customized: load a preset, extend the body and regroup the delimiter.
puts "== customized =="
custom = Baseh.baseh_medium_v1
custom[:profile_id] = "orders-v1"
custom[:body_length] = 7
custom[:grouping] = [5, 4]
orders = Baseh::Baseh.new(custom)
show("encode(id: 123456789)") { orders.encode(id: 123456789) }
show("decode(...) round trip") { orders.decode(orders.encode(id: 123456789)).id }
show('decode("ZC8VR-EMJ2") (bad check)') { orders.decode("ZC8VR-EMJ2").id }
show("capacity") { orders.capacity }

# 4. Typo correction: a spoken-confusion flip is amended back to the
# canonical code. The frozen tiers absorb every spoken pair as a typed
# alias, so correction is shown on a profile where both P and T can be
# issued and a misheard T only the checksum can catch.
puts "== typo correction =="
radio = Baseh::Baseh.new(
  profile_id: "radio-v1",
  body_alphabet: "0123456789ABCDEFGHJKMNPQRSTVWXYZ",
  body_length: 6,
  checksum_alphabet: "234679ACDEFGHJKMNPQRTUVWXY",
  checksum_length: 1,
  case_sensitive: false,
  separator: "-",
  grouping: [4, 3],
  aliases: { "O" => "0", "I" => "1", "L" => "1" },
  permutation: { enabled: false }
)
show('decode("0000-T0W") without correction') { radio.decode("0000-T0W").id }
result = radio.decode("0000-T0W", try_correction: true, confusion_profile: :light)
puts "Identifier: #{result.id}, corrected to #{result.canonical_code}"
