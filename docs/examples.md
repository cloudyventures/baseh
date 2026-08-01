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
npm install base-human
```

### Zero configuration

```typescript
import { toCode, fromCode } from "base-human";

toCode(123456789n);           // "74UYC19"   (bigint, number or decimal string)
toCode("123456789");          // "74UYC19"
fromCode("74UYC19");          // 123456789n
fromCode("74uyc 19");         // 123456789n  (lowercase and stray spaces accepted)

fromCode("74UYC1X");          // throws BasehError [INVALID_CHECKSUM]
toCode(481890304n);           // throws BasehError [OUT_OF_RANGE]: id == capacity
```

### Frozen preset

```typescript
import { Baseh, BasehError, basehMediumV1 } from "base-human";

const medium = new Baseh(basehMediumV1());

medium.encode(123456789n);    // "74UYC19"
medium.decode("74UYC19").id;  // 123456789n
medium.decode("OOOOOOC").id;  // 0n  (typed O aliases to 0)
medium.capacity();            // 481890304n

medium.encode(1131n);         // throws BasehError [BLOCKED_CODE]
medium.decode("742YC19");     // throws BasehError [INVALID_CHECKSUM]

try {
  medium.decode("742YC19");
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
custom.separator = "-";
custom.grouping = [4, 4];
const orders = new Baseh(custom);

orders.encode(123456789n);                       // "074U-YC1J"
orders.decode(orders.encode(123456789n)).id;     // 123456789n
orders.decode("D4UY-C190");  // throws BasehError [INVALID_CHECKSUM]
orders.capacity();           // 13492928512n
```

## Python

```bash
pip install base-human
```

### Zero configuration

```python
from base_human import to_code, from_code

to_code(123456789)            # "74UYC19"   (int or decimal string)
to_code("123456789")          # "74UYC19"
from_code("74UYC19")          # 123456789
from_code("74uyc 19")         # 123456789

from_code("74UYC1X")          # raises BasehError [INVALID_CHECKSUM]
to_code(481890304)            # raises BasehError [OUT_OF_RANGE]
```

### Frozen preset

```python
from base_human import Baseh, BasehError, baseh_medium_v1

medium = Baseh(baseh_medium_v1())

medium.encode(123456789)      # "74UYC19"
medium.decode("74UYC19").id   # 123456789
medium.decode("OOOOOOC").id   # 0
medium.capacity()             # 481890304

try:
    medium.decode("742YC19")
except BasehError as e:
    print(e.code, e)          # INVALID_CHECKSUM ...

medium.encode(1131)           # raises BasehError [BLOCKED_CODE]
```

### Customized profile

```python
custom = baseh_medium_v1()    # fresh mutable dict per call
custom["profileId"] = "orders-v1"
custom["bodyLength"] = 7
custom["separator"] = "-"
custom["grouping"] = [4, 4]
orders = Baseh(custom)

orders.encode(123456789)                      # "074U-YC1J"
orders.decode(orders.encode(123456789)).id    # 123456789
orders.decode("D4UY-C190")   # raises BasehError [INVALID_CHECKSUM]
orders.capacity()            # 13492928512
```

## Go

```bash
go get github.com/matellis/baseh/go
```

### Zero configuration

```go
basehuman.ToCode(big.NewInt(123456789))   // "74UYC19", nil
basehuman.ToCodeString("123456789")       // "74UYC19", nil
basehuman.FromCode("74UYC19")             // 123456789, nil
basehuman.FromCode("74uyc 19")            // 123456789, nil

basehuman.FromCode("74UYC1X")             // nil, *Error [INVALID_CHECKSUM]
basehuman.ToCode(big.NewInt(481890304))   // "", *Error [OUT_OF_RANGE]
```

### Frozen preset

```go
medium, err := basehuman.NewBaseh(basehuman.BasehMediumV1())
if err != nil {
    panic(err) // only possible if the frozen profile itself were broken
}

medium.Encode(big.NewInt(123456789))      // "74UYC19", nil

result, err := medium.Decode("74UYC19", nil)
if err != nil {
    var be *basehuman.Error
    if errors.As(err, &be) {
        // be.Code, be.Message, be.SafeForCustomer
    }
}
result.ID                                 // 123456789

medium.Decode("OOOOOOC", nil)             // id 0 (typed O aliases to 0)
medium.Capacity()                         // 481890304
medium.Encode(big.NewInt(1131))           // "", *Error [BLOCKED_CODE]
```

### Customized profile

```go
custom := basehuman.BasehMediumV1()  // fresh mutable Profile per call
custom.ProfileID = "orders-v1"
custom.BodyLength = 7
custom.Separator = "-"
custom.Grouping = []int{4, 4}
orders, err := basehuman.NewBaseh(custom)

orders.Encode(big.NewInt(123456789))             // "074U-YC1J", nil
orders.Decode("D4UY-C190", nil)                  // nil, *Error [INVALID_CHECKSUM]
orders.Capacity()                                // 13492928512
```

## Rust

```bash
cargo add base-human
```

### Zero configuration

```rust
use base_human::{from_code, to_code};

to_code(123456789u64)         // Ok("74UYC19")   (u8..u128, usize, BigUint, &str)
to_code("123456789")          // Ok("74UYC19")
from_code("74UYC19")          // Ok(123456789)
from_code("74uyc 19")         // Ok(123456789)

from_code("74UYC1X")          // Err(BasehError { code: InvalidChecksum, .. })
to_code(481890304u64)         // Err(BasehError { code: OutOfRange, .. })
```

### Frozen preset

```rust
use base_human::{baseh_medium_v1, Baseh, DecodeOptions};

let medium = Baseh::new(baseh_medium_v1())?;

medium.encode(&BigUint::from(123456789u64))     // Ok("74UYC19")

match medium.decode("742YC19", &DecodeOptions::strict()) {
    Ok(result) => println!("{}", result.id),
    Err(e) => eprintln!("{:?}: {}", e.code, e.message),
}

medium.decode("OOOOOOC", &DecodeOptions::strict())  // Ok(id = 0)
medium.capacity()                                   // 481890304
medium.encode(&BigUint::from(1131u64))              // Err([BlockedCode])
```

### Customized profile

```rust
let mut custom = baseh_medium_v1();
custom.profile_id = "orders-v1".to_string();
custom.body_length = 7;
custom.separator = "-".to_string();
custom.grouping = vec![4, 4];
let orders = Baseh::new(custom)?;

orders.encode(&BigUint::from(123456789u64))    // Ok("074U-YC1J")
orders.decode("D4UY-C190", &DecodeOptions::strict())  // Err([InvalidChecksum])
orders.capacity()                              // 13492928512
```

## Ruby

```bash
gem install base-human
```

### Zero configuration

```ruby
require "base_human"

BaseHuman.to_code(123456789)      # "74UYC19"   (Integer or decimal String)
BaseHuman.to_code("123456789")    # "74UYC19"
BaseHuman.from_code("74UYC19")    # 123456789
BaseHuman.from_code("74uyc 19")   # 123456789

BaseHuman.from_code("74UYC1X")    # raises BasehError [INVALID_CHECKSUM]
BaseHuman.to_code(481890304)      # raises BasehError [OUT_OF_RANGE]
```

### Frozen preset

```ruby
medium = BaseHuman::Baseh.new(BaseHuman.baseh_medium_v1)

medium.encode(id: 123456789)      # "74UYC19"
medium.decode("74UYC19").id       # 123456789
medium.decode("OOOOOOC").id       # 0
medium.capacity                   # 481890304

begin
  medium.decode("742YC19")
rescue BaseHuman::BasehError => e
  warn "#{e.code}: #{e.message}"  # INVALID_CHECKSUM ...
end

medium.encode(id: 1131)           # raises BasehError [BLOCKED_CODE]
```

### Customized profile

```ruby
custom = BaseHuman.baseh_medium_v1   # fresh mutable hash per call
custom[:profile_id] = "orders-v1"
custom[:body_length] = 7
custom[:separator] = "-"
custom[:grouping] = [4, 4]
orders = BaseHuman::Baseh.new(custom)

orders.encode(id: 123456789)                     # "074U-YC1J"
orders.decode(orders.encode(id: 123456789)).id   # 123456789
orders.decode("D4UY-C190")   # raises BasehError [INVALID_CHECKSUM]
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
