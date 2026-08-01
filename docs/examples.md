# Examples

Three usage patterns for each implementation:

1. **Zero configuration**: `encode` / `decode` over the default expandable
   profile (`baseh-expandable-v1`); `decode` returns the full `DecodeResult`.
2. **Frozen preset**: load `baseh-medium-v1` and use the full codec.
3. **Customized**: load a preset, modify it and build a codec from the result.

Every language section also closes with a framework **view helper**
(rendering codes at the edge in Express, Django, html/template, ERB, or a
plain handler), and the Ruby section adds **issuing codes**: a shared codec
wrapping a single issuance counter. Both patterns are covered in depth in
`docs/cookbook.md`.

Each language section also leads with the **expandable** mode
(`baseh-expandable-v1`): codes start at 4 characters and grow automatically
as the id sequence climbs. Expandable is the default for new users and backs
the zero-configuration `encode` / `decode` facade above.

Every implementation produces identical codes for identical inputs (enforced
by the shared test vectors in `vectors/`). Error codes are identical too;
only message casing differs between languages.

Each pattern shows input, output and error trapping. Every example here is
also a runnable file that prints exactly the output shown:

| Language | Run |
|---|---|
| JavaScript/TypeScript | `js/examples/examples.ts` (run `./node_modules/.bin/tsx examples/examples.ts` from `js/`) |
| Python | `python/examples/examples.py` (run `PYTHONPATH=src python3 examples/examples.py` from `python/`) |
| Go | `go/examples/main.go` (run `go run ./examples` from `go/`) |
| Rust | `rust/examples/examples.rs` (run `cargo run --example examples` from `rust/`) |
| Ruby | `ruby/examples/examples.rb` (run `ruby -I lib examples/examples.rb` from `ruby/`) |

## JavaScript / TypeScript

```bash
npm install @cloudyventures/baseh
```

### Expandable mode (shipping in the next release)

```typescript
import { Baseh, basehExpandableV1 } from "@cloudyventures/baseh";

// Codes start at 4 characters and grow automatically as ids climb past
// each length's capacity. No `0`/`O` in the body, no left-padding, and no
// separator until codes reach 6 characters. Shorter codes already issued
// keep decoding forever.
const expandable = new Baseh(basehExpandableV1());

expandable.encode(123456789n);  // 4 characters at this namespace size; grows as ids climb
expandable.decode(expandable.encode(42n)).id;  // 42n (round trip)

// Customized expandable: `minLength` sets the starting length and
// `separatorMinLength` sets when hyphen grouping kicks in.
const growable = basehExpandableV1();
growable.profileId = "invoices-v1";
growable.minLength = 5;
growable.separatorMinLength = 8;
const invoices = new Baseh(growable);
invoices.encode(42n);  // starts at 5 characters, no separator until 8+
```

### Zero configuration

```typescript
import { encode, decode, validate } from "@cloudyventures/baseh";

// Backed by the expandable v1 default profile: codes start at 4 characters
// and grow with the id sequence, so there is no practical capacity limit.
encode(123456789n);           // "KUQU-ANMD"   (bigint or number)
encode(123456789);            // "KUQU-ANMD"
decode("KUQU-ANMD").id;       // 123456789n   (full DecodeResult: { id, canonicalCode, corrected })
decode("kuqu-anmd").id;       // 123456789n   (lowercase accepted; spaces via { acceptSpaces: true })

decode("KUQU-ANMX");          // throws BasehError [INVALID_CHECKSUM]
encode(-1);                   // throws BasehError [OUT_OF_RANGE]: negative id
validate("KUQU-ANMD");        // { valid: true, canonicalCode: "KUQU-ANMD" }
```

### Frozen preset

```typescript
import { Baseh, BasehError, basehMediumV1 } from "@cloudyventures/baseh";

const medium = new Baseh(basehMediumV1());

medium.encode(123456789n);    // "C8XP-8J49"
medium.decode("C8XP-8J49").id;  // 123456789n
medium.decode("UORY-PDCA").id;  // 1n  (typed O aliases to 0)
medium.capacity();            // 481890304n

medium.encode(813n);          // throws BasehError [BLOCKED_CODE]
medium.decode("C8XP-8JX9");   // throws BasehError [INVALID_CHECKSUM]

try {
  medium.decode("C8XP-8JX9");
} catch (e) {
  if (e instanceof BasehError) {
    console.error(e.code, e.message);  // never match on the message alone
  }
}
```

### Customized profile

```typescript
const custom = basehMediumV1();
custom.profileId = "orders-v1";   // helpers return fresh mutable profiles
custom.bodyLength = 7;
custom.grouping = [5, 4];
const orders = new Baseh(custom);

orders.encode(123456789n);                       // "ZC8VR-EMJY"
orders.decode(orders.encode(123456789n)).id;     // 123456789n
orders.decode("ZC8VR-EMJX");  // throws BasehError [INVALID_CHECKSUM]
orders.capacity();           // 13492928512n
```

### Correction (amended code)

When a typo fails the checksum but one spoken-confusion swap yields exactly
one valid code, decode returns the amended code with `corrected: true`:

```typescript
// Using the custom full-alphabet tickets-v1 profile (see js/examples/examples.ts):
const r = tickets.decode("00000BKD", { tryCorrection: true, confusionProfile: "light" });
// r.id === 13n, r.corrected === true, r.canonicalCode === "0000-0DKD"
```

The frozen tiers absorb the common swaps as direct aliases, so genuine
correction needs a profile that keeps both partners canonical, which is why
the demo uses a custom profile. Every language's `examples/` file prints a
working demonstration of this case.

### View helper

```typescript
// A view helper for route handlers: one shared codec built at module
// scope, records rendered as codes at the edge. In Express, pass the string
// to the template (res.render("order", { code: basehCode(order) })) or
// register it as a view helper; here it is exercised framework-free with a
// plain object. The matching decode-side pattern is in docs/cookbook.md
// ("Framework view helpers").
const codec = new Baseh(basehExpandableV1());
function basehCode(record: { id: bigint }): string {
  return codec.encode(record.id);
}
const order = { id: 123456n };
basehCode(order);                    // code to pass to the template
codec.decode(basehCode(order)).id;   // 123456n (round trip)
codec.decode("ZZZZ-ZZZZ");           // throws BasehError [INVALID_CHECKSUM]
```

## Python

```bash
pip install baseh
```

### Expandable mode (shipping in the next release)

```python
from baseh import Baseh, baseh_expandable_v1

# Codes start at 4 characters and grow automatically as ids climb;
# shorter codes keep decoding forever.
expandable = Baseh(baseh_expandable_v1())

expandable.encode(123456789)  # 4 characters at this namespace size; grows as ids climb
expandable.decode(expandable.encode(123456789)).id  # 123456789 (round trip)
expandable.decode(expandable.encode(42).lower()).id  # 42 (case-insensitive)

# Customized expandable: "minLength" sets the starting length and
# "separatorMinLength" sets when hyphen grouping kicks in. A custom
# bodyAlphabet has any 0/O silently removed.
custom_exp = baseh_expandable_v1()
custom_exp["profileId"] = "tickets-v1"
custom_exp["minLength"] = 5
custom_exp["separatorMinLength"] = 8
tickets = Baseh(custom_exp)
tickets.encode(123456789)  # 5+ characters, no hyphen until codes reach 8 characters
```

### Zero configuration

```python
from baseh import encode, decode

# Backed by the expandable v1 default profile: codes start at 4 characters
# and grow with the id sequence, so there is no practical capacity limit.
encode(123456789)             # "KUQU-ANMD"
decode("KUQU-ANMD").id        # 123456789   (full DecodeResult: id, canonical_code, corrected)
decode("kuqu-anmd").id        # 123456789   (lowercase accepted; spaces via accept_spaces=True)

decode("KUQU-ANMX")           # raises BasehError [INVALID_CHECKSUM]
encode(-1)                    # raises BasehError [OUT_OF_RANGE]: negative id
```

### Frozen preset

```python
from baseh import Baseh, BasehError, baseh_medium_v1

medium = Baseh(baseh_medium_v1())

medium.encode(123456789)      # "C8XP-8J49"
medium.decode("C8XP-8J49").id  # 123456789
medium.decode("UORY-PDCA").id  # 1
medium.capacity()             # 481890304

try:
    medium.decode("C8XP-8JX9")
except BasehError as e:
    print(e.code, e)          # INVALID_CHECKSUM ...

medium.encode(813)            # raises BasehError [BLOCKED_CODE]
```

### Customized profile

```python
custom = baseh_medium_v1()    # fresh mutable dict per call
custom["profileId"] = "orders-v1"
custom["bodyLength"] = 7
custom["grouping"] = [5, 4]
orders = Baseh(custom)

orders.encode(123456789)                      # "ZC8VR-EMJY"
orders.decode(orders.encode(123456789)).id    # 123456789
orders.decode("ZC8VR-EMJX")   # raises BasehError [INVALID_CHECKSUM]
orders.capacity()            # 13492928512
```

### View helper

```python
# A view helper: one shared codec built at import time, records rendered
# as codes at the edge. Register baseh_code as a template filter in Django
# ({{ order.id|baseh_code }}); here it is exercised framework-free with a
# plain class. The matching decode-side pattern is in docs/cookbook.md
# ("Framework view helpers").
codec = Baseh(baseh_expandable_v1())


def baseh_code(record):
    return codec.encode(record.id)


class Order:
    def __init__(self, id):
        self.id = id


order = Order(123456)
baseh_code(order)                   # rendered code for the template
codec.decode(baseh_code(order)).id  # 123456 (round trip)
codec.decode("ZZZZ-ZZZZ")           # raises BasehError [INVALID_CHECKSUM]
```

## Go

```bash
go get github.com/cloudyventures/baseh/go/v2
```

### Expandable mode (shipping in the next release)

```go
// Codes start at 4 characters and grow automatically as ids climb past
// each length's capacity — no migration, and old short codes keep decoding.
exp, err := baseh.New(baseh.ExpandableV1())
if err != nil {
    panic(err)
}

exp.Encode(big.NewInt(123456789))  // 4 characters at this namespace size; grows as ids climb

expCode, err := exp.Encode(big.NewInt(123456789))
if err != nil {
    panic(err)
}
result, err := exp.Decode(expCode, nil)
result.ID  // 123456789 (round trip)

// Expandable profiles customize like any other: Mode is "expandable",
// MinLength (default 4) sets the starting code width and
// SeparatorMinLength (6 in the baseh-expandable-v1 tier) controls when
// hyphens and grouping kick in.
```

### Zero configuration

```go
// Backed by the expandable v1 default profile: codes start at 4 characters
// and grow with the id sequence, so there is no practical capacity limit.
baseh.Encode(big.NewInt(123456789))   // "KUQU-ANMD", nil

result, err := baseh.Decode("KUQU-ANMD", nil)
result.ID                             // 123456789 (DecodeResult: ID, CanonicalCode, Corrected)
baseh.Decode("kuqu-anmd", nil)        // id 123456789 (lowercase accepted)

baseh.Decode("KUQU-ANMX", nil)        // nil, *Error [INVALID_CHECKSUM]
baseh.Validate("KUQU-ANMD", nil)      // ValidateResult{Valid: true, ...}
baseh.Default()                       // the shared default codec behind Encode/Decode
```

### Frozen preset

```go
medium, err := baseh.New(baseh.MediumV1())
if err != nil {
    panic(err) // only possible if the frozen profile itself were broken
}

medium.Encode(big.NewInt(123456789))      // "C8XP-8J49", nil

result, err := medium.Decode("C8XP-8J49", nil)
if err != nil {
    var be *baseh.Error
    if errors.As(err, &be) {
        // be.Code, be.Message, be.SafeForCustomer
    }
}
result.ID                                 // 123456789

medium.Decode("UORY-PDCA", nil)           // id 1 (typed O aliases to 0)
medium.Capacity()                         // 481890304
medium.Encode(big.NewInt(813))            // "", *Error [BLOCKED_CODE]
```

### Customized profile

```go
custom := baseh.MediumV1()  // fresh mutable Profile per call
custom.ProfileID = "orders-v1"
custom.BodyLength = 7
custom.Grouping = []int{5, 4}
orders, err := baseh.New(custom)

orders.Encode(big.NewInt(123456789))             // "ZC8VR-EMJY", nil
orders.Decode("ZC8VR-EMJX", nil)                 // nil, *Error [INVALID_CHECKSUM]
orders.Capacity()                                // 13492928512
```

### View helper (html/template)

```go
// A view helper for html/template: one shared codec built at boot,
// records rendered as codes at the edge via a FuncMap entry. Runs on the
// stdlib alone; the matching decode-side pattern is in docs/cookbook.md
// ("Framework view helpers").
helper, err := baseh.New(baseh.ExpandableV1())
if err != nil {
    panic(err)
}
tmpl, err := template.New("order").Funcs(template.FuncMap{
    "basehCode": func(id int64) string {
        code, err := helper.Encode(big.NewInt(id))
        if err != nil {
            return ""
        }
        return code
    },
}).Parse("Order #{{ .ID }} is {{ basehCode .ID }}")
if err != nil {
    panic(err)
}

var buf strings.Builder
err = tmpl.Execute(&buf, struct{ ID int64 }{123456})
buf.String()                                     // "Order #123456 is <code>"

orderCode, err := helper.Encode(big.NewInt(123456))
result, err := helper.Decode(orderCode, nil)
result.ID                                        // 123456 (round trip)
helper.Decode("ZZZZ-ZZZZ", nil)                  // nil, *Error [INVALID_CHECKSUM]
```

## Rust

```bash
cargo add baseh
```

### Expandable mode (shipping in the next release)

```rust
use baseh::{baseh_expandable_v1, Baseh, DecodeOptions};
use num_bigint::BigUint;

// Codes start at 4 characters and grow one character at a time as the id
// sequence climbs — old shorter codes keep decoding forever.
let expandable = Baseh::new(baseh_expandable_v1())?;
let strict = DecodeOptions::strict();

expandable.encode(&BigUint::from(123456789u64))
// a few characters longer than the 4-character minimum; no left-padding

let code = expandable.encode(&BigUint::from(123456789u64))?;
expandable.decode(&code, &strict)?.id  // 123456789 (round trip)

// Customized expandable: `min_length` sets the shortest codes (default 4)
// and `separator_min_length` controls when hyphen grouping appears (the
// shipped tier uses 6 — shorter codes carry no separator).
let mut growing = baseh_expandable_v1();
growing.profile_id = "invoices-v1".to_string();
growing.min_length = 5;
growing.separator_min_length = 7;
let invoices = Baseh::new(growing)?;
invoices.encode(&BigUint::from(123456789u64))
```

### Zero configuration

```rust
use baseh::{encode, decode};
use num_bigint::BigUint;

// Backed by the expandable v1 default profile: codes start at 4 characters
// and grow with the id sequence, so there is no practical capacity limit.
encode(&BigUint::from(123456789u64))  // Ok("KUQU-ANMD")
decode("KUQU-ANMD")?.id;              // 123456789 (DecodeResult: id, canonical_code, corrected)
decode("kuqu-anmd")?.id;              // 123456789 (lowercase accepted)

decode("KUQU-ANMX")                   // Err(BasehError { code: InvalidChecksum, .. })
```

### Frozen preset

```rust
use baseh::{baseh_medium_v1, Baseh, DecodeOptions};

let medium = Baseh::new(baseh_medium_v1())?;

medium.encode(&BigUint::from(123456789u64))     // Ok("C8XP-8J49")

match medium.decode("C8XP-8JX9", &DecodeOptions::strict()) {
    Ok(result) => println!("{}", result.id),
    Err(e) => eprintln!("{:?}: {}", e.code, e.message),
}

medium.decode("UORY-PDCA", &DecodeOptions::strict())  // Ok(id = 1)
medium.capacity()                                   // 481890304
medium.encode(&BigUint::from(813u64))               // Err([BlockedCode])
```

### Customized profile

```rust
let mut custom = baseh_medium_v1();
custom.profile_id = "orders-v1".to_string();
custom.body_length = 7;
custom.grouping = vec![5, 4];
let orders = Baseh::new(custom)?;

orders.encode(&BigUint::from(123456789u64))    // Ok("ZC8VR-EMJY")
orders.decode("ZC8VR-EMJX", &DecodeOptions::strict())  // Err([InvalidChecksum])
orders.capacity()                              // 13492928512
```

### View helper

```rust
// A view helper for handlers: one shared codec built at boot, records
// rendered as codes at the edge. Call baseh_code in the handler and pass
// the rendered string to the template engine; here it is exercised
// framework-free. The matching decode-side pattern is in
// docs/cookbook.md ("Framework view helpers").
fn baseh_code(codec: &Baseh, id: u64) -> String {
    codec.encode(&BigUint::from(id)).expect("in range")
}

let helper = Baseh::new(baseh_expandable_v1())?;
let order_id = 123456u64;
baseh_code(&helper, order_id)                              // code for the template
helper.decode(&baseh_code(&helper, order_id), &strict)?.id // 123456 (round trip)
helper.decode("ZZZZ-ZZZZ", &strict)                        // Err([InvalidChecksum])
```

## Ruby

```bash
gem install baseh
```

### Expandable mode (shipping in the next release)

```ruby
# Codes start short and grow one character as the id sequence climbs.
expandable = Baseh::Baseh.new(Baseh.baseh_expandable_v1)

expandable.encode(id: 123456)   # 4 characters at this namespace size; grows as ids climb
expandable.decode(expandable.encode(id: 123456)).id  # 123456 (round trip)

# A keyed private-mapping variant mirrors the other -p tiers:
#   Baseh.baseh_expandable_p_v1(key_bytes: ..., key_id: "prod-01")
# Expandable profiles accept :mode ("expandable" or "fixed"), :min_length
# (default 4) and :separator_min_length (the tier uses 6 — no hyphen until
# codes reach that length).
```

### Zero configuration

```ruby
require "baseh"

# Backed by the expandable v1 default profile: codes start at 4 characters
# and grow with the id sequence, so there is no practical capacity limit.
Baseh.encode(123456789)       # "KUQU-ANMD"
Baseh.decode("KUQU-ANMD").id  # 123456789   (DecodeResult: id, canonical_code, corrected)
Baseh.decode("kuqu-anmd").id  # 123456789   (lowercase accepted; spaces via accept_spaces: true)

Baseh.decode("KUQU-ANMX")     # raises BasehError [INVALID_CHECKSUM]
Baseh.default                 # the shared codec behind Baseh.encode/decode
```

### Frozen preset

```ruby
medium = Baseh::Baseh.new(Baseh.baseh_medium_v1)

medium.encode(id: 123456789)      # "C8XP-8J49"
medium.decode("C8XP-8J49").id     # 123456789
medium.decode("UORY-PDCA").id     # 1
medium.capacity                   # 481890304

begin
  medium.decode("C8XP-8JX9")
rescue Baseh::BasehError => e
  warn "#{e.code}: #{e.message}"  # INVALID_CHECKSUM ...
end

medium.encode(id: 813)            # raises BasehError [BLOCKED_CODE]
```

### Customized profile

```ruby
custom = Baseh.baseh_medium_v1   # fresh mutable hash per call
custom[:profile_id] = "orders-v1"
custom[:body_length] = 7
custom[:grouping] = [5, 4]
orders = Baseh::Baseh.new(custom)

orders.encode(id: 123456789)                     # "ZC8VR-EMJY"
orders.decode(orders.encode(id: 123456789)).id   # 123456789
orders.decode("ZC8VR-EMJX")   # raises BasehError [INVALID_CHECKSUM]
orders.capacity              # 13492928512
```

### View helper (ERB)

```ruby
# A view helper for ERB: one shared codec built at boot, records rendered
# as codes at the edge. This module works as a Rails helper exactly as
# written; here it is exercised with a plain struct. The matching
# controller-side decode pattern is in docs/cookbook.md ("Framework view
# helpers").
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
baseh_code(order)                                # rendered code for the view
BasehHelper::CODEC.decode(baseh_code(order)).id  # 123456 (controller-side decode)
BasehHelper::CODEC.decode("ZZZZ-ZZZZ")           # raises BasehError [INVALID_CHECKSUM]
```

### Issuing codes

```ruby
# Issuing codes: the expandable issuance-counter pattern, runnable without
# a database. One shared codec wraps a single counter; each call increments
# and encodes, so issued codes never look sequential even though the ids
# are. In production the ivar below is swapped for a Postgres SEQUENCE or
# an atomically-incremented counters row — exactly one writer, and the
# counter is backed up with the database. See docs/cookbook.md ("Issuing
# codes").
class Issuer
  def initialize(codec)
    @codec = codec
    @next_id = 0 # production: SELECT nextval('codes_seq') or an atomic UPDATE
  end

  def issue
    @next_id += 1
    @codec.encode(id: @next_id)
  end

  def decode(code)
    @codec.decode(code).id
  end
end

issuer = Issuer.new(Baseh::Baseh.new(Baseh.baseh_expandable_v1))
issued = Array.new(6) { issuer.issue }  # six non-sequential-looking codes
issuer.decode(issued.first)             # 1
```

## Notes on error trapping

- Every implementation raises or returns a single error type (`BasehError`)
  with a stable machine-readable `code`. Match on the code, never on the
  message text.
- Codes: `INVALID_PROFILE`, `OUT_OF_RANGE`, `PERMUTATION_FAILURE`,
  `INVALID_LENGTH`, `INVALID_CHARACTER`, `INVALID_CHECKSUM`,
  `AMBIGUOUS_INPUT`, `TOO_MANY_CANDIDATES`, `BLOCKED_CODE`.
- `BLOCKED_CODE` on encode means the id maps to a blocklisted word and is
  never issued; skip the id and try the next one.
- On decode failure no internal id is exposed. Use `validate` where you only
  need a boolean.
- Decoders accept a code typed without its leading zero body symbols:
  `decode("XR")` returns the same id as `decode("000000XR")`. Encoders
  always emit the fixed-width canonical code (spec 3.4).
