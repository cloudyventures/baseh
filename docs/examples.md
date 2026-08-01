# Examples

Three usage patterns for each implementation:

1. **Zero configuration**: `toCode` / `fromCode` over the default Medium tier.
2. **Frozen preset**: load `baseh-medium-v1` and use the full codec.
3. **Customized**: load a preset, modify it and build a codec from the result.

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

### Zero configuration

```typescript
import { toCode, fromCode } from "@cloudyventures/baseh";

toCode(123456789n);           // "C8XP-8J49"   (bigint, number or decimal string)
toCode("123456789");          // "C8XP-8J49"
fromCode("C8XP-8J49");        // 123456789n
fromCode("c8xp 8j4 9");       // 123456789n  (lowercase and stray spaces accepted)

fromCode("C8XP-8J4X");        // throws BasehError [INVALID_CHECKSUM]
toCode(481890304n);           // throws BasehError [OUT_OF_RANGE]: id == capacity
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

## Python

```bash
pip install baseh
```

### Zero configuration

```python
from baseh import to_code, from_code

to_code(123456789)            # "C8XP-8J49"   (int or decimal string)
to_code("123456789")          # "C8XP-8J49"
from_code("C8XP-8J49")        # 123456789
from_code("c8xp 8j4 9")       # 123456789

from_code("C8XP-8J4X")        # raises BasehError [INVALID_CHECKSUM]
to_code(481890304)            # raises BasehError [OUT_OF_RANGE]
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

## Go

```bash
go get github.com/cloudyventures/baseh/go/v2
```

### Zero configuration

```go
basehuman.ToCode(big.NewInt(123456789))   // "C8XP-8J49", nil
basehuman.ToCodeString("123456789")       // "C8XP-8J49", nil
basehuman.FromCode("C8XP-8J49")           // 123456789, nil
basehuman.FromCode("c8xp 8j4 9")          // 123456789, nil

basehuman.FromCode("C8XP-8J4X")           // nil, *Error [INVALID_CHECKSUM]
basehuman.ToCode(big.NewInt(481890304))   // "", *Error [OUT_OF_RANGE]
```

### Frozen preset

```go
medium, err := basehuman.NewBaseh(basehuman.BasehMediumV1())
if err != nil {
    panic(err) // only possible if the frozen profile itself were broken
}

medium.Encode(big.NewInt(123456789))      // "C8XP-8J49", nil

result, err := medium.Decode("C8XP-8J49", nil)
if err != nil {
    var be *basehuman.Error
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
custom := basehuman.BasehMediumV1()  // fresh mutable Profile per call
custom.ProfileID = "orders-v1"
custom.BodyLength = 7
custom.Grouping = []int{5, 4}
orders, err := basehuman.NewBaseh(custom)

orders.Encode(big.NewInt(123456789))             // "ZC8VR-EMJY", nil
orders.Decode("ZC8VR-EMJX", nil)                 // nil, *Error [INVALID_CHECKSUM]
orders.Capacity()                                // 13492928512
```

## Rust

```bash
cargo add baseh
```

### Zero configuration

```rust
use baseh::{from_code, to_code};

to_code(123456789u64)         // Ok("C8XP-8J49")   (u8..u128, usize, BigUint, &str)
to_code("123456789")          // Ok("C8XP-8J49")
from_code("C8XP-8J49")        // Ok(123456789)
from_code("c8xp 8j4 9")       // Ok(123456789)

from_code("C8XP-8J4X")        // Err(BasehError { code: InvalidChecksum, .. })
to_code(481890304u64)         // Err(BasehError { code: OutOfRange, .. })
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

## Ruby

```bash
gem install baseh
```

### Zero configuration

```ruby
require "baseh"

Baseh.to_code(123456789)      # "C8XP-8J49"   (Integer or decimal String)
Baseh.to_code("123456789")    # "C8XP-8J49"
Baseh.from_code("C8XP-8J49")  # 123456789
Baseh.from_code("c8xp 8j4 9") # 123456789

Baseh.from_code("C8XP-8J4X")  # raises BasehError [INVALID_CHECKSUM]
Baseh.to_code(481890304)      # raises BasehError [OUT_OF_RANGE]
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
