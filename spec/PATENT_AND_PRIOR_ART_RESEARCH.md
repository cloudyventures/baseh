# BaseH Prior Art and Patent Research

## 1. Scope and limitation

This document is an engineering review, not a legal opinion. It identifies established techniques relevant to a reversible human-facing alphanumeric reference codec.

A qualified patent attorney should review the final implementation and target jurisdictions before launch when patent risk is material.

## 2. Executive conclusion

The core building blocks are well established:

- Positional base-N conversion.
- Human-oriented restricted alphabets.
- Input aliases for visually similar symbols.
- Checksums.
- Reversible integer permutation.
- Short-ID libraries.
- Error-detecting code design.

The recommended implementation should combine standard, independently implemented components and avoid claiming a novel general monopoly over short human-readable references.

The most important engineering controls are:

1. Keep a dated design record.
2. Use published techniques.
3. Avoid copying proprietary code, private symbol tables or protected branding.
4. Perform a claim-focused patent review if commercialization or litigation exposure justifies it.
5. Treat the BaseH name as provisional until trademark clearance.

## 3. Relevant prior art

### 3.1 RFC 4648 Base32

RFC 4648 defines standard Base32 encoding. Its common alphabet omits zero and one because they can be confused with letters in some contexts.

Relevance:

- Established use of a restricted 32-symbol alphabet.
- Fixed mapping between values and symbols.
- Broad implementation availability.

Difference from BaseH:

- RFC 4648 encodes byte sequences.
- BaseH primarily encodes bounded non-negative integers.
- BaseH adds profile versioning, optional permutation, input aliases and configurable checksums.

### 3.2 Base32 for Humans

An IETF Internet-Draft published in 2026 formalizes a human-oriented Base32 approach. Its stated goals include human readability, compactness and error resistance.

Relevance:

- Strong evidence that human-oriented Base32 alphabets are an active standards topic.
- Useful terminology and interoperability considerations.
- Supports using an established base rather than inventing an arbitrary alphabet.

Status:

- Internet-Draft, not a final Internet Standard as of the research date.
- Re-check status before implementation freeze.

### 3.3 Crockford-style Base32

The widely implemented Crockford approach uses a 32-symbol canonical alphabet, accepts common aliases and defines an optional checksum symbol set.

Notable behaviours:

- Canonical output excludes `I`, `L`, `O` and `U`.
- Input may treat `I` and `L` as `1`.
- Input may treat `O` as `0`.
- An optional modulus-based check symbol can be added.

Relevance:

- Direct prior art for canonical exclusions plus permissive input aliases.
- Direct prior art for a checksum attached to a human-oriented base encoding.
- Strong reason not to claim those elements as novel.

Recommended use:

- Either adopt a compatible profile or document deliberate differences.
- Do not use the Crockford name in a product name without separate naming review.

### 3.4 z-base-32

z-base-32 rearranges the symbol alphabet for human use and omits padding. It is used in existing systems.

Relevance:

- Prior art for optimizing alphabet order and symbol choice for human handling.
- Shows that alternative Base32 alphabets are established.

### 3.5 Sqids

Sqids is an open-source short-ID library that converts non-negative numbers into short URL-safe identifiers. It supports custom shuffled alphabets and many language implementations.

Relevance:

- Prior art for reversible short identifiers derived from numbers.
- Prior art for custom alphabets and deterministic cross-language output.
- Useful implementation comparison.

Important limitation:

Sqids states that its output is not encryption. BaseH should make the same limitation explicit.

### 3.6 Bech32 and Bech32m

BIP 173 introduced Bech32 with a checksum designed for strong detection of common transcription errors. BIP 350 adjusted the checksum constant for later address versions after analysis of an error class.

Relevance:

- Demonstrates that checksum design should be evaluated against realistic error patterns.
- Demonstrates the value of published reference code and test vectors.
- Shows that checksum tradeoffs can require later correction.

Recommendation:

Do not claim that a simple one-symbol checksum offers Bech32-level detection. BaseH version 1 should publish measured properties and remain conservative.

### 3.7 General check algorithms

Established options include:

- Luhn.
- Verhoeff.
- Damm.
- CRC families.
- BCH codes.
- Reed-Solomon codes.
- Hash-based truncated checks.

Relevance:

Checksum and error correction are mature fields. A custom checksum should be chosen only when its behaviour is measured and documented.

## 4. Patent search observations

A broad search finds many patents involving alphanumeric encoding, lot codes, packaging codes, checksums, scanning and machine-readable symbols.

One example is a patent publication describing lot identification codes with an optional alphanumeric checksum. Another granted patent concerns encoding and decoding alphanumeric data for transmission and scanning.

These examples show why keyword overlap is not enough to assess infringement. Patent risk depends on the exact claims, required steps, jurisdiction, status and implementation.

## 5. Claim-focused review process

Before launch, counsel should search and review claims covering combinations such as:

- Reversible conversion of numeric records into short customer-facing alphanumeric codes.
- Restricted character alphabets selected for human transcription.
- Alias-based normalization.
- Checksum-assisted candidate correction.
- Dynamic configuration tools that calculate capacity.
- Reverse configuration tools driven by capacity requirements.
- Reversible permutation within a bounded non-power-of-two domain.
- Specific customer-support or order-reference workflows.

For each candidate family, record:

```text
publication number
family members
priority date
jurisdictions
assignee
legal status
independent claims
claim elements mapped to BaseH
non-infringement position
invalidity or prior-art notes
risk level
```

## 6. Engineering choices that reduce risk

- Implement standard base conversion directly.
- Use a public human-oriented alphabet or a documented independent alphabet.
- Use established alias conventions.
- Use a published checksum where its properties fit.
- Keep candidate correction bounded and checksum-validated.
- Use standard HMAC-based Feistel construction for optional permutation.
- Avoid copying source code unless its license is reviewed.
- Keep a record of source licenses and versions.
- Avoid proprietary terminology.
- Do not market the system as providing geographic encoding, secrecy or guaranteed error correction.

## 7. Open-source license review

Before adopting a library, record:

- Project name.
- Exact version.
- License.
- Copyright notices.
- Transitive dependencies.
- Notice requirements.
- Patent grant or retaliation language.
- Maintenance status.
- Security history.

Permissive licenses are usually simplest, but legal review should confirm the selected package.

## 8. Build or adopt

### Adopt an existing library when:

- Its alphabet and checksum meet requirements.
- Cross-language support is strong.
- The license is acceptable.
- Output compatibility is stable.
- The implementation is maintained.

### Build a thin internal codec when:

- Exact profile control is required.
- A bounded-domain permutation is required.
- Existing libraries do not expose needed aliases or checksum behaviour.
- Cross-language vectors can be maintained internally.

Recommended approach:

Build a small profile-driven wrapper around standard primitives. Reuse cryptographic primitives from mature libraries. Do not implement HMAC or SHA-256 manually.

## 9. Trademark and naming

The working name `Human Reference Code` is descriptive. Descriptive names may be difficult to protect and may conflict with existing uses.

Before public launch:

1. Search federal and relevant state trademark databases.
2. Search company names, package registries, domains and app stores.
3. Review confusingly similar marks in software and customer-support classes.
4. Select a distinctive product name if trademark protection matters.

Do not rely on domain availability as clearance.

## 10. Data and privacy

The code may indirectly identify a customer record. Treat it according to the sensitivity of the linked record.

- Do not embed customer attributes.
- Do not expose database sequence where business volume is sensitive.
- Do not treat permutation as anonymization.
- Apply retention rules to logs.
- Avoid recording full references in analytics unless necessary.
- Use authorization after decoding.

## 11. Security distinction

| Property | BaseH provides it? |
|---|---|
| Compact representation | Yes |
| Deterministic decoding | Yes |
| Routine typo detection | With checksum |
| Limited ambiguity resolution | Optional |
| Encryption | No |
| Authentication | No |
| Authorization | No |
| Unpredictability | Only superficial with permutation |
| Protection from enumeration | No, requires endpoint controls |

## 12. Recommended legal review trigger

Obtain a formal claim review before public launch when any of these apply:

- The system is sold as a standalone product.
- Reference generation is a major competitive feature.
- Volume or revenue makes litigation material.
- The system operates in multiple jurisdictions.
- Marketing claims emphasize a novel error-correction method.
- A patent owner sends notice.
- The implementation adopts a nonstandard correction algorithm.

For ordinary internal use, the commercial risk may be lower but is not automatically zero.

## 13. Research sources reviewed

Primary and authoritative sources should be retained in the project research file:

1. RFC 4648, Base-N Encodings.
2. IETF Internet-Draft, Base32 for Humans, draft status checked July 2026.
3. Sqids official documentation and FAQ.
4. BIP 173 reference specification.
5. BIP 350 reference specification.
6. Google Patents records for representative alphanumeric encoding and checksum patents.
7. Official project documentation for any selected implementation library.

## 14. Research gaps before production

- Full patent family search by a patent professional.
- Trademark clearance for the final product name.
- Empirical spoken-confusion study for the target customer population.
- Empirical visual-confusion study across fonts and devices.
- Measured checksum performance against the selected confusion model.
- License review of the final dependency list.
- Review of accessibility and localization requirements.

## 15. Final recommendation

Proceed with an implementation based on established base-N encoding, a reviewed restricted alphabet, direct input aliases, a published or thoroughly measured checksum and optional standard Feistel permutation.

Do not present the codec as encryption or guaranteed correction. Keep the implementation profile-driven and versioned. Complete claim-focused legal review when the business exposure warrants it.
