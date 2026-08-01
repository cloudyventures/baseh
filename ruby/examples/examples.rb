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
show('Baseh.from_code("74UYC19")') { Baseh.from_code("74UYC19") }
show('Baseh.from_code("74uyc 19")') { Baseh.from_code("74uyc 19") }
show('Baseh.from_code("74UYC1X")') { Baseh.from_code("74UYC1X") }
show("Baseh.to_code(481890304)") { Baseh.to_code(481890304) }

# 2. A frozen preset: load baseh-medium-v1 and use the full codec.
puts "== preset =="
medium = Baseh::Baseh.new(Baseh.baseh_medium_v1)
show("encode(id: 123456789)") { medium.encode(id: 123456789) }
show('decode("74UYC19").id') { medium.decode("74UYC19").id }
show('decode("OOOOOOC").id (typed aliases)') { medium.decode("OOOOOOC").id }
show("encode(id: 1131) (blocked word)") { medium.encode(id: 1131) }
show('decode("742YC19") (checksum typo)') { medium.decode("742YC19").id }
show("capacity") { medium.capacity }

# 3. Customized: load a preset, extend the body and add a delimiter.
puts "== customized =="
custom = Baseh.baseh_medium_v1
custom[:profile_id] = "orders-v1"
custom[:body_length] = 7
custom[:separator] = "-"
custom[:grouping] = [4, 4]
orders = Baseh::Baseh.new(custom)
show("encode(id: 123456789)") { orders.encode(id: 123456789) }
show("decode(...) round trip") { orders.decode(orders.encode(id: 123456789)).id }
show('decode("D4UY-C190") (bad check)') { orders.decode("D4UY-C190").id }
show("capacity") { orders.capacity }
