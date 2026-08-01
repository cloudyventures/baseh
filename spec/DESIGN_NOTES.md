# BaseH Design Notes

## 1. Key decisions

### 1.1 Codes are aliases

The database ID remains authoritative. BaseH is a customer-facing representation.

### 1.2 Capacity comes only from the body

Checksum characters do not create additional valid IDs.

### 1.3 Canonical output is stricter than accepted input

The encoder emits one exact form. The decoder may accept case changes, separators and explicitly configured aliases.

### 1.4 Correction must abstain when ambiguous

Returning no answer is safer than returning the wrong record.

### 1.5 Profiles are immutable

Any change to alphabet, checksum, permutation or formatting requires a new profile ID.

### 1.6 ASCII only in version 1

This avoids Unicode lookalikes, normalization differences and cross-language implementation drift.

## 2. Alphabet catalog

The implementation should maintain a versioned catalog rather than hard-code safety levels in UI components.

Example:

```yaml
catalog_version: 1
alphabets:
  base10:
    symbols: "0123456789"
  base16:
    symbols: "0123456789ABCDEF"
  base32_default:
    symbols: "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  base36:
    symbols: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
```

Each catalog item should include:

- Stable ID.
- Symbols.
- Intended use.
- Known visual issues.
- Known spoken issues.
- Direct aliases.
- Candidate pairs.
- Review date.
- Evidence notes.

## 3. Safety profiles

Safety levels are product presets, not universal truths. Spoken confusion varies by accent, audio quality, language and context. Visual confusion varies by font, size, screen quality and user vision.

The UI must expose the actual symbols and pairs.

The normative spoken pair list (capacity calculator 3.5) strips one member of each sound-alike pair from generation alphabets and aliases the stripped symbol back to the kept one, ordered from the most common confusion at Light to the least at Heavy. Keep the pair list conservative and test it with target users before enabling higher levels by default.

## 4. One checksum or two

### One checksum symbol

Advantages:

- Short.
- Suitable when a human agent can request repetition.
- Lower friction.

Disadvantages:

- Relatively high random false acceptance.
- More chance of ambiguous correction.

### Two checksum symbols

Advantages:

- Stronger detection.
- Better for unattended self-service.
- Fewer ambiguous correction cases.

Disadvantages:

- One extra displayed character.
- More typing.

Recommendation:

- Assisted support: one.
- Self-service record lookup: two.
- High consequence workflow: use a stronger standard and additional authentication.

## 5. Correction versus detection

A checksum can validate candidate substitutions but does not, by itself, guarantee correction.

Correction flow:

1. Parse canonical and direct aliases.
2. Validate checksum.
3. If invalid, generate a small set of plausible one-symbol substitutions.
4. Validate each candidate.
5. Accept only one unique valid candidate.

Do not describe this as general error correction.

## 6. Sequence masking

Options:

### None

Best for simplicity and debugging.

### Additive offset modulo capacity

Simple but preserves adjacency.

### Multiplicative affine permutation

Works only when multiplier is coprime with capacity. Still reveals structure.

### Feistel permutation

More complex but creates a stronger presentation shuffle and supports inversion.

Recommendation:

Use Feistel only when sequence appearance matters. Keep it server-side.

## 7. Namespace strategy

Codes can collide across namespaces even when each namespace is internally unique.

Options:

- Namespace parameter supplied to lookup.
- Distinct prefix per namespace.
- Separate profile per namespace.
- Global shared internal ID sequence.

Recommendation:

Use an explicit namespace in the lookup API. Add a visible prefix only when customers regularly handle codes from multiple domains.

## 8. Archival and reuse

Reusing a code after archival creates serious customer-service risk. Old emails, screenshots and exports may remain.

Recommendation:

Do not reuse codes within the same namespace unless there is a compelling requirement and a generation marker prevents stale lookup.

Capacity planning should cover lifetime issuance where practical, not only active records.

## 9. Prefixes

A fixed prefix does not add capacity.

Examples:

```text
T-7KM4Q2H
O-1DP-8R7-C
```

Prefixes improve context but increase length.

Do not place customer or product attributes in a prefix unless that disclosure is acceptable.

## 10. Sorting

A shuffled or custom alphabet may not preserve numeric sort order. A permutation will not preserve it.

Use internal IDs or timestamps for sorting.

## 11. Profanity and accidental strings

Alphanumeric codes can accidentally contain unwanted short sequences.

Possible controls:

- Exclude selected symbols.
- Reject and cycle-walk blocked bodies.
- Use a blocklist.
- Add a neutral prefix.
- Accept that short random strings cannot eliminate every interpretation.

Blocklist rejection reduces effective capacity and must be deterministic. It can also introduce language and cultural maintenance obligations.

Recommendation:

Do not add a blocklist in version 1 unless customer testing shows a real problem.

## 12. Case

Canonical uppercase is recommended.

Benefits:

- Easier visual distinction in many fonts.
- Common support workflow.
- Case-insensitive entry.

Do not use case as extra capacity when customers type or dictate codes.

## 13. Separators

Separators improve chunking but add length.

Recommended grouping:

- The frozen profiles use no separators. Custom profiles that add their own should keep groups of 3 or 4.
- Five body plus one check: `3-3`.
- Six body plus two check: `4-4` or `3-3-2`.

The final checksum group should be visually identifiable in internal tools, but customer-facing interfaces need not label it.

## 14. Fonts

Use a font with clear glyph distinction.

Test:

- `0 O`
- `1 I L`
- `5 S`
- `8 B`
- `2 Z`
- `6 G`

Even when the alphabet excludes some symbols, staff tools may show user-entered invalid input. The font must make the issue visible.

## 15. Voice workflow

Agent UI should:

1. Display the code in chunks.
2. Highlight the checksum group subtly.
3. Permit slow character-by-character readback.
4. Validate as the agent types.
5. Show `valid`, `corrected`, `ambiguous` or `invalid`.
6. Never jump to a record until validation and authorization complete.

## 16. Localization

Version 1 remains ASCII and language-neutral at the symbol level.

Localization still affects:

- Spoken confusion pairs.
- Character names.
- Error messages.
- Grouping conventions.
- Right-to-left interfaces.
- Screen reader pronunciation.

Create separate spoken-safety catalogs by locale. Do not assume an English-language confusion map applies globally.

## 17. Telemetry for tuning

Collect aggregated events:

- Direct success.
- Alias success.
- Checksum failure.
- Unique correction success.
- Ambiguous correction.
- Manual repeat requested.
- Abandonment.

Do not automatically expand the alias map from anecdotal failures. Review data, then release a new profile or correction catalog version.

## 18. Profile migration

Existing codes must continue to resolve.

Migration options:

- Decode old profile and re-render new code on next customer interaction.
- Maintain both codes.
- Keep old code as secondary alias.
- Never change the visible code.

Recommendation:

Keep the original code valid for the record lifetime. New records may use a new profile.

## 19. Database patterns

### Generated on lookup

Pros:

- No duplicate storage.
- Easy profile logic.

Cons:

- Harder direct indexed lookup unless decoding is always used.

### Stored canonical code

Pros:

- Simple unique index.
- Easy reporting.

Cons:

- Storage duplication.
- Migration requires care.

Recommendation:

Decode code to internal ID, then query by internal ID. Store profile ID with the record.

## 20. API idempotence

Encoding is deterministic for a fixed profile and key. Decoding a canonical code then encoding the result must return the same canonical code.

This property should be treated as a compatibility contract.

## 21. Future extensions

Potential profile versions may add:

- Stronger BCH-style checksum.
- Two-symbol correction with formal distance guarantees.
- Byte-array payloads.
- Explicit version symbol.
- Tenant-specific namespaces.
- Offline mobile decoder.
- Batch import and validation.
- Hardware scanner support.
- Signed references using a message authentication code.
- Expiring bearer links with a separate secret token.

Each extension requires a new profile or new outer protocol.

## 22. Decisions deferred

- Final spoken candidate sets.
- Default checksum length by product.
- Whether sequence masking is enabled.
- Final public product name.
- Whether codes are stored or generated.
- Exact correction telemetry retention.
- Whether a blocked-string policy is required.

## 23. Recommended first release

```yaml
profile_id: baseh-medium-v1
alphabet: "0123456789ACDEFGHJKMPQRUVXYZ"
body_length: 6
checksum_length: 1
case_sensitive: false
aliases:
  O: "0"
  I: "1"
  L: "1"
  T: "P"
  N: "M"
  W: "V"
correction:
  enabled: false
permutation:
  enabled: false
format:
  grouping: []
  separator: ""
```

Enable correction only after checksum testing and customer confusion data are available.
