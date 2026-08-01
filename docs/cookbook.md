# baseH Application Cookbook

Application-level guidance for hosting a baseH lookup. These patterns are not part
of the library; the library is a pure, stateless codec. Moved here from the codec
specification so the normative spec covers library behaviour only.

## Lookup endpoint

```http
POST /v1/reference/resolve
Content-Type: application/json

{
  "code": "7KM-4Q2-H",
  "namespace": "support-ticket"
}
```

Response:

```json
{
  "status": "resolved",
  "canonicalCode": "7KM-4Q2-H"
}
```

Do not return the internal ID to untrusted clients unless required.

## Live input validation

For a code entry field that gives feedback as the user types, `validate()` is the
right primitive but it must not be called on every keystroke directly.

Spec 3.4 re-padding is the reason. `normalize()` pads a short input with leading
body zero symbols before checking it, so a half-typed code is validated as though
the user had typed the missing leading zeros. Usually that yields
`INVALID_CHECKSUM`, which paints the field red on every keystroke, and once in a
while the padded prefix passes the checksum and the field goes green in the middle
of a word. Measured over 20,951 prefixes of Medium codes, calling `validate()`
per keystroke produced 17 false greens.

Gate on the typed length first, then validate. The pattern below never reports
`valid` for an incomplete code:

```typescript
import { Baseh, normalize, basehMediumV1 } from "@cloudyventures/baseh";

const codec = new Baseh(basehMediumV1());
const p = codec.profile;
const expected = p.bodyLength + p.checksumLength;
const zero = p.bodyAlphabetNorm[0] as string;
const WS = /[\t\n\v\f\r ]/;

type Live =
  | { state: "empty" }
  | { state: "typing"; typed: string; progress: number }
  | { state: "bad-char" }
  | { state: "too-long" }
  | { state: "invalid"; reason: string }
  | { state: "valid"; id: bigint; canonical: string };

/** Insert separators into a partially typed code, as far as the groups go. */
function formatPartial(raw: string): string {
  if (p.separator.length === 0) return raw;
  const parts: string[] = [];
  let offset = 0;
  for (const size of p.grouping) {
    if (offset >= raw.length) break;
    parts.push(raw.slice(offset, offset + size));
    offset += size;
  }
  return parts.join(p.separator);
}

export function inspect(input: string): Live {
  const cleaned = [...input].filter((ch) => !WS.test(ch) && ch !== p.separator);
  const typed = cleaned.length;
  if (typed === 0) return { state: "empty" };
  if (typed > expected) return { state: "too-long" };

  // Pad to full length before normalizing, so a partial code can never raise
  // INVALID_LENGTH and the only failure left is a symbol outside the alphabet.
  let raw: string;
  try {
    raw = normalize(zero.repeat(expected - typed) + cleaned.join(""), p, true);
  } catch {
    return { state: "bad-char" };
  }

  if (typed < expected) {
    const shown = formatPartial(raw.slice(-typed));
    return { state: "typing", typed: shown, progress: typed / expected };
  }

  const result = codec.validate(input, { acceptSpaces: true });
  if (!result.valid) return { state: "invalid", reason: result.reason ?? "INVALID_CHECKSUM" };
  const decoded = codec.decode(input, { acceptSpaces: true });
  return { state: "valid", id: decoded.id, canonical: decoded.canonicalCode };
}
```

Call it straight from the `input` event. No debounce is needed: the work is
arithmetic over a handful of symbols, with no allocation worth avoiding.

How to render each state:

| State | UI |
|---|---|
| `empty` | Neutral. No message. |
| `typing` | Neutral, never red. Show `typed` back in the field, optionally a progress hint. |
| `bad-char` | Reject the keystroke rather than showing an error. |
| `too-long` | Reject the keystroke. |
| `invalid` | Red, with a message keyed on `reason`, never on the message text. |
| `valid` | Green, and replace the field contents with `canonical`. |

Two behaviours are worth knowing before writing the error copy:

- Visually confusable input is already handled during normalization, not by
  correction. The frozen profiles alias `O` to `0`, `I` and `L` to `1`, `B` to
  `8`, `S` to `5`, `T` to `P`, `N` to `M` and `W` to `V`, so those characters
  decode cleanly and reach `valid`. An `INVALID_CHECKSUM` from a frozen profile
  means a genuinely wrong symbol, not a lookalike.
- `tryCorrection` and `confusionProfile` therefore add little on frozen profiles,
  since the confusable pairs are not in the alphabet to begin with. They earn
  their place on custom profiles that keep pairs like `B` and `D` distinct, where
  a `suggest` state offering `decode(input, { tryCorrection: true }).canonicalCode`
  is worth adding to the union above.

Applying the same recipe to the other implementations is mechanical: every one of
them exposes `normalize`, `validate` and `decode` with these semantics.

## Framework view helpers

The codec is pure and stateless, so one instance per profile can live for the
whole process. Build it once, share it, and render codes at the edge — the
database stores the integer id, never the code string.

### Rails / ERB

```ruby
# app/helpers/baseh_helper.rb
module BasehHelper
  # Built once at boot; the codec is immutable after preparation and safe to
  # share across threads and requests.
  CODEC = Baseh::Baseh.new(Baseh.baseh_expandable_v1)

  # <%= baseh_code(@order) %> -> "8J4Q" (grows as the id space climbs)
  def baseh_code(record)
    CODEC.encode(id: record.id)
  end
end
```

```erb
<p>Your reference is <strong><%= baseh_code(@order) %></strong>.</p>
```

Decoding is controller work, not helper work. Treat the code as an opaque
alias: decode, then authorize, and return the same response for "no such
record" and "not yours" (see the security checklist below):

```ruby
class OrdersController < ApplicationController
  before_action :set_order, only: :show

  private

  def set_order
    id = BasehHelper::CODEC.decode(params[:code]).id
    @order = current_account.orders.find(id)
  rescue Baseh::BasehError, ActiveRecord::RecordNotFound
    render_not_found
  end
end
```

Three rules make this pattern work:

- **One codec, not one per request.** `Baseh::Baseh.new` runs profile
  preparation (alphabet derivation, key scheduling). Hoist it into a constant
  or an initializer; never build it inside the helper method.
- **Keep the id server-side.** The helper emits the code; the record's integer
  id never appears in markup, URLs or logs. The route carries the code
  (`/orders/8J4Q`), the controller decodes it.
- **Catch `Baseh::BasehError`, branch on `e.code` if you must, not on the
  message text.** Typed `O`/`I`/`L`, lowercase and missing separators are
  normalized away before decoding, so a rescue here means a genuinely wrong or
  out-of-namespace code — the same user-facing "not found" either way.

### Other frameworks

The recipe is identical everywhere; only the injection point differs:

- **Django (Python)**: a custom template filter (`@register.filter`) wrapping a
  module-level `Baseh(baseh_expandable_v1())` — `{{ order.id|baseh_code }}`.
- **Express (TypeScript)**: a module-level codec with a locals/helper function,
  or format in the route handler and pass the string to the template.
- **Go `html/template`**: register a `template.FuncMap` entry (`"basehCode"`)
  closing over the shared `*baseh.Codec`.
- **Rust**: call the codec in the handler and pass the rendered string into
  whichever template engine you use; a filter/helper indirection buys little.

## Observability

Record:

- Profile ID.
- Decode success or failure class.
- Whether direct aliases were applied.
- Whether correction was attempted.
- Whether correction succeeded.
- Ambiguous candidate count.
- Endpoint latency.
- Rate-limit events.

Do not log full codes when they may be treated as customer data. Hash or partially mask them.

## Security checklist

- Enforce authorization after lookup.
- Rate-limit public lookup endpoints.
- Return identical errors for missing and unauthorized records.
- Log abnormal enumeration attempts.
- Add a separate random secret when bearer-style access is required.
