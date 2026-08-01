# BaseH Capacity Calculator

## 1. Purpose

The capacity calculator lets a user change code parameters and immediately see the resulting identifier capacity, displayed length, validation strength and operational lifetime.

This is the forward tool: parameters go in and capabilities come out.

## 2. Primary user story

As a system designer, I can select alphabets, safety levels, body length and checksum length so I can understand how many unique references the configuration supports.

## 3. Inputs

### 3.1 Namespace

Optional label used only in saved configurations.

Examples:

- Support tickets
- Orders
- Returns

### 3.2 Body length

Allowed range:

```text
1 through 10 in the standard UI
1 through 32 in advanced mode
```

### 3.3 Base alphabet mode

Options:

- Digits only
- Uppercase letters only
- Alphanumeric
- Custom

### 3.4 Visual safety

Preset behaviour:

| Level | Canonical exclusions |
|---|---|
| None | No exclusions |
| Light | Exclude `O`, `I`, `L` when digits are present |
| Medium | Light plus exclude one or more context-dependent pairs such as `B/8` and `S/5` |
| Heavy | User-reviewed conservative alphabet |

The exact alphabet must always be displayed. Presets are configuration helpers, not hidden rules.

### 3.5 Spoken safety

Spoken safety strips one member of each sound-alike pair from every generation alphabet and aliases the stripped symbol back to the kept member on input. A misheard letter can therefore never appear in a freshly encoded code, and a code entered with it decodes automatically as the kept letter. No ambiguity and no correction search is involved because the alias mapping is deterministic.

Pairs are cumulative by level, ordered from the most common sound-alike confusion to the least:

| Level | Pairs removed (kept <- removed) |
|---|---|
| None | No changes |
| Light | `B <- D`, `P <- T` |
| Medium | Light plus `M <- N`, `V <- W` |
| Heavy | Medium plus `F <- S`, `C <- G` |

Rules:

1. A pair applies only when the kept symbol is present in the body alphabet.
2. Each applied pair removes its second symbol from both the body alphabet and the checksum alphabet, so the alias source is never a canonical symbol. Each removal shrinks the alphabet and therefore capacity.
3. The alias maps the removed symbol to the kept symbol exactly like the built-in `O -> 0` aliases.

The UI must show the resulting alphabet size and every active pair.

### 3.6 Checksum length

Allowed:

```text
0 through 3 in standard mode
0 through 8 in advanced mode
```

### 3.7 Checksum alphabet

Default to the safe checksum alphabet. Permit custom configuration in advanced mode.

### 3.8 Permutation

The shipped tool does not expose permutation. Permutation is a codec-level opt-in for applications that manage their own server-side key; it has no place in a client-side preview because any key visible to the browser is public by definition. Live previews and exported configurations are always unpermuted.

### 3.9 Formatting

- Separator
- Grouping
- Prefix
- Suffix

Prefix and suffix do not add capacity unless they are part of a versioned namespace.

### 3.10 Operational demand

Optional fields:

- New records per day
- Retention period in days
- Safety margin
- Peak multiplier

## 4. Outputs

### 4.1 Exact body capacity

```text
capacity = alphabet_size ^ body_length
```

Use arbitrary-precision integer arithmetic.

### 4.2 Displayed code count

The calculator may show:

```text
displayed_combinations =
    body_capacity * checksum_alphabet_size ^ checksum_length
```

Label this clearly as displayed combinations, not valid identifiers. Only one checksum sequence is valid for each body.

### 4.3 Bits of capacity

```text
bits = body_length * log2(alphabet_size)
```

This may use floating point for display only.

### 4.4 Maximum ID

```text
maximum_id = capacity - 1
```

### 4.5 Required capacity

When operational demand fields are present:

```text
required =
    ceil(records_per_day * retention_days * peak_multiplier * safety_margin)
```

Recommended defaults:

```text
peak_multiplier = 1.25
safety_margin = 2.0
```

### 4.6 Utilization

```text
utilization = required / capacity
```

Status thresholds:

- Green: at or below 50 percent.
- Amber: above 50 percent through 80 percent.
- Red: above 80 percent.
- Invalid: required exceeds capacity.

### 4.7 Lifetime

When records per day is greater than zero:

```text
lifetime_days = floor(capacity / records_per_day)
```

Also show approximate years.

### 4.8 Random checksum false acceptance

```text
false_acceptance = 1 / checksum_states
checksum_states = checksum_alphabet_size ^ checksum_length
```

This is a simple random-error estimate. It is not a security guarantee.

## 5. UI layout

### 5.1 Desktop

Three columns:

1. Configuration controls.
2. Live code preview and capacity.
3. Operational fit and warnings.

### 5.2 Mobile

Single column:

1. Summary card.
2. Body settings.
3. Safety settings.
4. Checksum settings.
5. Demand settings.
6. Detailed results.

### 5.3 Summary card

Display:

```text
1,073,741,824 valid references
7 displayed characters
30.0 bits of capacity
Approx. 4% random checksum false acceptance
```

Never abbreviate the exact capacity without also providing the full number.

## 6. Live examples

Show at least five deterministic examples. Examples must update when the profile changes.

Example IDs:

```text
0
1
alphabet_size - 1
alphabet_size
capacity - 1
```

If permutation is enabled, also show that the same IDs render differently but decode identically.

## 7. Presets

Ship with:

### 7.1 Compact numeric

```yaml
alphabet: "0123456789"
body_length: 6
checksum_length: 1
```

Capacity:

```text
1,000,000
```

### 7.2 Safe alphanumeric

```yaml
alphabet: "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
body_length: 6
checksum_length: 1
```

Capacity:

```text
1,073,741,824
```

### 7.3 Short support

```yaml
alphabet: "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
body_length: 5
checksum_length: 1
```

Capacity:

```text
33,554,432
```

### 7.4 High validation

```yaml
alphabet: "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
body_length: 6
checksum_length: 2
```

Capacity remains:

```text
1,073,741,824
```

## 8. Validation

Reject or flag:

- Duplicate alphabet symbols.
- Case collisions in case-insensitive mode.
- Alphabet smaller than two symbols.
- Separator found in an alphabet.
- Group sizes that do not match total length.
- Alias target absent from the canonical alphabets.
- Demand values below zero.
- Capacity beyond the selected runtime's supported integer range.
- Custom alphabet containing non-ASCII symbols in version 1.

## 9. Exact arithmetic

JavaScript:

```typescript
function powBigInt(base: bigint, exponent: number): bigint {
  if (base < 0n || exponent < 0) {
    throw new Error("invalid exponentiation input");
  }

  let result = 1n;
  let factor = base;
  let power = exponent;

  while (power > 0) {
    if (power % 2 === 1) {
      result *= factor;
    }

    power = Math.floor(power / 2);

    if (power > 0) {
      factor *= factor;
    }
  }

  return result;
}
```

Do not calculate capacity with floating point then round.

## 10. State model

```typescript
type CapacityCalculatorState = {
  profileDraft: BasehProfileDraft;
  demand: {
    recordsPerDay?: bigint;
    retentionDays?: bigint;
    peakMultiplier?: number;
    safetyMargin?: number;
  };
  advancedMode: boolean;
};
```

Derived results must not be stored separately unless memoized. Recalculate from state to avoid drift.

## 11. Shareable configuration

Support:

- Copy JSON.
- Download YAML.
- URL query state for non-secret settings.
- Reset to preset.

Never include permutation key material in exported browser state.

## 12. Accessibility

- Every control has a visible label.
- Capacity updates use an `aria-live="polite"` region.
- Do not use colour as the only status indicator.
- Tables remain readable at 200 percent zoom.
- Exact values can be copied without separators.
- Keyboard operation covers every control.

## 13. Warnings

Examples:

- `No checksum`: Typing errors cannot be detected reliably.
- `Small capacity`: Demand uses more than 80 percent of capacity.
- `Unsafe sequence`: Permutation is off, so adjacent IDs may appear adjacent.
- `Too many aliases`: Input may produce ambiguous candidates.
- `One checksum state`: Invalid checksum alphabet or length.
- `Client-side key`: Permutation secret must not be exported to the browser.

## 14. Acceptance criteria

1. Every control updates results without a page reload.
2. Exact capacity is correct for all standard-mode values.
3. Checksum length never changes valid body capacity.
4. Presets load exact documented values.
5. Invalid configurations cannot be exported.
6. The full profile JSON can be copied.
7. The UI works without a mouse.
8. Calculations match the codec library.
9. Unit tests cover every formula.
10. Browser tests cover mobile and desktop layouts.
