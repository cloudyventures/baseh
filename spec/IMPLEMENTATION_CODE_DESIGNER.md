# baseH Code Designer

## 1. Purpose

The code designer starts with a required number of identifiers and finds configurations that satisfy the requirement.

This is the reverse tool: capability requirements go in and valid parameters come out.

## 2. Primary user story

As a system designer, I can enter how many active or lifetime references I need so the tool can recommend the shortest acceptable code and constrain settings that would make the design invalid.

## 3. Inputs

Required:

- Required unique identifiers.

Optional:

- Records per day.
- Retention period.
- Peak multiplier.
- Safety margin.
- Maximum displayed length.
- Minimum checksum length.
- Allowed alphabet types.
- Visual safety level.
- Spoken safety level.
- Permutation preview (off by default).
- Maximum utilization.
- Preferred grouping.

The permutation preview only changes how example codes render (via the built-in public preview key). It never affects feasibility, ranking or capacity and is not part of the exported design.

## 4. Derived required capacity

When the user enters an explicit required capacity, use it directly.

When the user enters operational demand:

```text
required_capacity =
    ceil(records_per_day
         * retention_days
         * peak_multiplier
         * safety_margin)
```

If both are present, use the larger value.

## 5. Search space

Standard mode:

```text
body_length: 1..10
checksum_length: 0..3
alphabet presets: all enabled presets
visual safety: none, light, medium, heavy
spoken safety: none, light, medium, heavy
```

Advanced mode permits custom alphabets and body length through 32.

## 6. Feasibility

A configuration is feasible when:

```text
alphabet_size ^ body_length >= required_capacity
```

and all user constraints pass.

A checksum does not affect feasibility except through maximum displayed length.

## 7. Minimum length

For a fixed alphabet size `A`:

```text
L = ceil(log(required_capacity) / log(A))
```

The implementation must verify this result with integer exponentiation because floating-point logarithms may be off by one near exact powers.

```text
while A^(L - 1) >= R:
    L = L - 1

while A^L < R:
    L = L + 1
```

## 8. Ranking

Recommended default ranking, lowest score wins:

```text
score =
    displayed_length * 1000
  + utilization_penalty
  + alphabet_penalty
  + checksum_penalty
  + correction_penalty
```

### 8.1 Displayed length

```text
displayed_length =
    body_length
  + checksum_length
  + separator_count
  + prefix_length
  + suffix_length
```

This dominates ranking.

### 8.2 Utilization penalty

Prefer room for growth.

```text
utilization = required_capacity / capacity
```

Suggested penalty:

```text
0 to 50 percent: 0
50 to 70 percent: 20
70 to 80 percent: 100
80 to 90 percent: 500
above 90 percent: infeasible by default
```

### 8.3 Alphabet penalty

Prefer reviewed standard alphabets over custom alphabets.

Suggested:

```text
safe standard alphabet: 0
numeric: 10
custom reviewed: 20
custom unreviewed: infeasible
```

### 8.4 Checksum penalty

Do not penalize a required checksum. When optional, prefer one symbol for assisted support workflows and two for unattended lookup.

### 8.5 Correction penalty

Penalize large candidate maps because they increase ambiguity and testing complexity.

## 9. Constraint behaviour

The UI must never silently change a user-controlled value.

When a change makes the design infeasible:

1. Keep the selected value.
2. Mark the current design infeasible.
3. Show the closest repair.
4. Offer a one-click `Apply recommendation`.

Example:

> A five-character body with the selected alphabet supports 33,554,432 references. Your requirement is 50,000,000. Increase body length to six or permit a larger alphabet.

## 10. Recommendation

Always show one recommended design first.

Then show up to five alternatives grouped by tradeoff:

- Shortest.
- Stronger validation.
- Digits only.
- Highest spoken safety.
- Most growth room.

Do not show alternatives that violate a hard constraint.

## 11. Parameter limits

As the user changes controls, each control should show its valid range.

Example:

- Required capacity: 60,000,000.
- Alphabet size: 32.
- Body length 5: disabled because capacity is 33,554,432.
- Body length 6: first valid choice.
- Body length 7 through 10: valid but longer.

Where disabling would hide useful information, leave the option selectable and label it `insufficient`.

## 12. Solver algorithm

```text
function design(requirements):
    candidates = []

    for alphabetProfile in allowedAlphabetProfiles:
        alphabet = deriveAlphabet(alphabetProfile, requirements)

        for bodyLength in allowedBodyLengths:
            capacity = powInt(len(alphabet), bodyLength)

            for checksumLength in allowedChecksumLengths:
                config = buildConfig(
                    alphabet,
                    bodyLength,
                    checksumLength,
                    requirements
                )

                if not validProfile(config):
                    continue

                if capacity < requirements.requiredCapacity:
                    continue

                if displayedLength(config) > requirements.maxDisplayedLength:
                    continue

                if utilization(requirements, capacity)
                    > requirements.maxUtilization:
                    continue

                candidates.append({
                    config,
                    capacity,
                    score: score(config, requirements)
                })

    sort candidates by score, then:
        displayedLength ascending
        capacity ascending
        alphabetProfileId ascending

    return candidates
```

## 13. Determinism

The same inputs and catalog version must produce the same ordering.

Store:

```text
designer_version
alphabet_catalog_version
scoring_version
```

with exported recommendations.

## 14. Result card

Each candidate card displays:

- Example shape.
- Valid capacity.
- Required capacity.
- Utilization.
- Body length.
- Checksum length.
- Total displayed length.
- Alphabet size.
- Visual safety level.
- Spoken safety level.
- Random checksum false acceptance estimate.
- Main tradeoff sentence.

Example:

```text
Recommended: 6 body + 1 check
Capacity: 1,073,741,824
Required: 60,000,000
Utilization: 5.6%
Displayed shape: XXXXXXX
```

## 15. Comparison table

Columns:

- Candidate.
- Capacity.
- Utilization.
- Body.
- Check.
- Displayed.
- Alphabet.
- Validation.
- Safety.
- Recommendation reason.

Allow sorting but preserve the recommended badge.

## 16. Export

Export JSON:

```json
{
  "designerVersion": "1",
  "catalogVersion": "1",
  "requirements": {
    "requiredCapacity": "60000000",
    "maxDisplayedLength": 8,
    "minimumChecksumLength": 1
  },
  "recommendation": {
    "profileId": "draft-2026-07-31",
    "bodyAlphabet": "0123456789ABCDEFGHJKMNPQRSTVWXYZ",
    "bodyLength": 6,
    "checksumLength": 1
  }
}
```

Large integers are strings in JSON.

## 17. Edge cases

- Required capacity is zero: reject and request at least one.
- Required capacity is one: one body position still required.
- Exact power boundary: choose the exact minimum length.
- No candidate under maximum length: explain the minimum possible length.
- Custom alphabet of one symbol: invalid.
- Checksum alphabet too small: invalid.
- All canonical symbols excluded: invalid.
- Safety profile has alias cycles: invalid.
- Retention is indefinite: use lifetime volume or require explicit capacity.
- Multiple namespaces: calculate each separately unless they intentionally share one namespace.

## 18. Suggested defaults

```yaml
required_capacity: null
max_displayed_length: 9
minimum_checksum_length: 1
max_utilization: 0.50
visual_safety: light
spoken_safety: light
safety_margin: 2.0
peak_multiplier: 1.25
```

## 19. Acceptance criteria

1. Solver returns the shortest feasible recommendation.
2. Exact power boundaries are correct.
3. Hard constraints are never violated.
4. Soft preferences affect ranking only.
5. Every infeasible state includes a concrete repair.
6. UI never silently changes a user selection.
7. Exports include solver and catalog versions.
8. Results match the capacity calculator.
9. Property tests compare solver output against brute force.
10. Recommendation ordering is deterministic.
