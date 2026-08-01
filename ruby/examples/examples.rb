# frozen_string_literal: true

# Runnable examples for the baseh Ruby gem.
# Run from ruby/:  ruby -I lib examples/examples.rb

require "baseh"

def show(label)
  puts "#{label} -> #{yield.inspect}"
rescue Baseh::BasehError => e
  puts "#{label} -> raises BasehError [#{e.code}]: #{e.message}"
end

# 0. Zero configuration, expandable mode (the recommended default):
#    codes start short and grow one character as the id sequence climbs.
#    Expandable mode: shipping in the next release; shown here as the new default.
puts "== expandable (zero config) =="
expandable = Baseh::Baseh.new(Baseh.baseh_expandable_v1)
show("expandable.encode(id: 123456)") { expandable.encode(id: 123456) }
# => 4 characters at this namespace size; grows as ids climb
show("expandable round trip") { expandable.decode(expandable.encode(id: 123456)).id }
# A keyed private-mapping variant mirrors the other -p tiers:
#   Baseh.baseh_expandable_p_v1(key_bytes: ..., key_id: "prod-01")

# 1. Zero configuration, fixed mode: the default Medium tier behind two functions.
puts "== zero config (fixed) =="
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
#    For expandable profiles the same hash accepts :mode ("expandable" or
#    "fixed"), :min_length (default 4) and :separator_min_length (the tier
#    uses 6 — no hyphen until codes reach that length).
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

# 5. A view helper for ERB: one shared codec built at boot, records rendered
#    as codes at the edge. This module works as a Rails helper exactly as
#    written; here it is exercised with a plain struct. The matching
#    controller-side decode pattern is in docs/cookbook.md ("Framework view
#    helpers").
puts "== view helper (ERB) =="
module BasehHelper
  CODEC = Baseh::Baseh.new(Baseh.baseh_expandable_v1)

  # <%= baseh_code(@order) %>
  def baseh_code(record)
    CODEC.encode(id: record.id)
  end
end

Order = Struct.new(:id)
include BasehHelper
order = Order.new(123456)
puts "<%= baseh_code(@order) %> -> #{baseh_code(order)}"
show("controller-side decode") { BasehHelper::CODEC.decode(baseh_code(order)).id }
show("controller-side decode (bogus code)") { BasehHelper::CODEC.decode("ZZZZ-ZZZZ").id }
