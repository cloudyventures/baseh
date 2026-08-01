# frozen_string_literal: true

# Runnable examples for the baseh Ruby gem.
# Run from ruby/:  ruby -I lib examples/examples.rb

require "base_human"

def show(label)
  puts "#{label} -> #{yield.inspect}"
rescue BaseHuman::BasehError => e
  puts "#{label} -> raises BasehError [#{e.code}]: #{e.message}"
end

# 1. Zero configuration: the default Medium tier behind two functions.
puts "== zero config =="
show("BaseHuman.to_code(123456789)") { BaseHuman.to_code(123456789) }
show('BaseHuman.to_code("123456789")') { BaseHuman.to_code("123456789") }
show('BaseHuman.from_code("74UYC19")') { BaseHuman.from_code("74UYC19") }
show('BaseHuman.from_code("74uyc 19")') { BaseHuman.from_code("74uyc 19") }
show('BaseHuman.from_code("74UYC1X")') { BaseHuman.from_code("74UYC1X") }
show("BaseHuman.to_code(481890304)") { BaseHuman.to_code(481890304) }

# 2. A frozen preset: load baseh-medium-v1 and use the full codec.
puts "== preset =="
medium = BaseHuman::Baseh.new(BaseHuman.baseh_medium_v1)
show("encode(id: 123456789)") { medium.encode(id: 123456789) }
show('decode("74UYC19").id') { medium.decode("74UYC19").id }
show('decode("OOOOOOC").id (typed aliases)') { medium.decode("OOOOOOC").id }
show("encode(id: 1131) (blocked word)") { medium.encode(id: 1131) }
show('decode("742YC19") (checksum typo)') { medium.decode("742YC19").id }
show("capacity") { medium.capacity }

# 3. Customized: load a preset, extend the body and add a delimiter.
puts "== customized =="
custom = BaseHuman.baseh_medium_v1
custom[:profile_id] = "orders-v1"
custom[:body_length] = 7
custom[:separator] = "-"
custom[:grouping] = [4, 4]
orders = BaseHuman::Baseh.new(custom)
show("encode(id: 123456789)") { orders.encode(id: 123456789) }
show("decode(...) round trip") { orders.decode(orders.encode(id: 123456789)).id }
show('decode("D4UY-C190") (bad check)') { orders.decode("D4UY-C190").id }
show("capacity") { orders.capacity }
