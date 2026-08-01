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

For a code entry field that gives feedback as the user types, use the codec's
`inspect()` (spec 12.5). Calling `validate()` on every keystroke is subtly
wrong, and `inspect` exists because the failure mode is easy to miss.

Spec 3.4 re-padding is the reason. `normalize()` pads a short input with leading
body zero symbols before checking it, so a half-typed code is validated as though
the user had typed the missing leading zeros. Usually that yields
`INVALID_CHECKSUM`, which paints the field red on every keystroke, and once in a
while the padded prefix passes the checksum and the field goes green in the middle
of a word. Measured over 20,951 prefixes of Medium codes, calling `validate()`
per keystroke produced 17 false greens. `inspect` gates on the typed length
first: an incomplete code is never judged, and a complete one always is.

```typescript
import { Baseh, basehMediumV1 } from "@cloudyventures/baseh";

const codec = new Baseh(basehMediumV1()); // built once, shared for the page

field.addEventListener("input", () => {
  const r = codec.inspect(field.value);
  // r.state is "empty" | "typing" | "bad-char" | "too-long" | "invalid" | "valid"
  render(field, r);
});
```

It never throws on user input, so the `input` handler needs no try/catch, and no
debounce is needed either: the work is arithmetic over a handful of symbols. If
the default expandable profile is all you need, the zero-config facade is a bare
function: `inspect(input)` from the same package.

How to render each state:

| State | UI |
|---|---|
| `empty` | Neutral. No message. |
| `typing` | Neutral, never red. Show `typed` back in the field, optionally a progress hint. |
| `bad-char` | Reject the keystroke rather than showing an error. |
| `too-long` | Reject the keystroke. |
| `invalid` | Red, with a message keyed on `reason`, never on the message text. |
| `valid` | Green, and replace the field contents with `canonicalCode`. |

Two behaviours are worth knowing before writing the error copy:

- Visually confusable input is already handled during normalization, not by
  correction. The frozen profiles alias `O` to `0`, `I` and `L` to `1`, `B` to
  `8`, `S` to `5`, `T` to `P`, `N` to `M` and `W` to `V`, so those characters
  decode cleanly and reach `valid`. An `INVALID_CHECKSUM` from a frozen profile
  means a genuinely wrong symbol, not a lookalike.
- `tryCorrection` and `confusionProfile` therefore add little on frozen profiles,
  since the confusable pairs are not in the alphabet to begin with. They earn
  their place on custom profiles that keep pairs like `B` and `D` distinct, where
  a `suggest` flourish is worth layering on top: when `inspect` returns
  `invalid`, offer `decode(input, { tryCorrection: true }).canonicalCode` as a
  one-click fix.

All five implementations ship `inspect` with identical state names and payload
fields (spec 12.5 pins both, and the shared vectors pin the state machine), so
the table above ports without translation.

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

## Issuing codes (the expandable counter)

Expandable mode needs exactly one piece of operational state: a monotonically
increasing counter that hands out the next integer id. The codec itself stays
stateless; the counter is yours to keep.

A PostgreSQL sequence is the simplest correct counter — atomic across
connections, no locking logic to write:

```sql
CREATE SEQUENCE order_code_id;

-- Issuing a code:
--   id   = nextval('order_code_id')        -- one atomic call
--   code = CODEC.encode(id: id)            -- pure arithmetic, no I/O
```

Decoding never touches the counter: `CODEC.decode(code).id` recovers the id
from the string alone. There is no shuffling step either — the Feistel
permutation (spec 7) already makes sequential ids look random, so
`nextval` output can go straight into `encode`.

Some ids are unissuable and must be skipped: codes containing a blocklisted
word (spec 18) or a run of identical symbols at or beyond the profile's
`maxRepetition` (spec 21) fail `encode` with `BLOCKED_CODE`. The issuance
loop catches that error, advances to the next id and retries — blocked ids
are simply never handed out, exactly like the skipped blocklist ids.

Three warnings, all load-bearing:

- **The counter is critical state.** Back it up with the database it belongs
  to. A restore that loses it — or a sequence recreated at 1 — re-issues ids
  that are already live as codes in the wild.
- **Exactly one writer.** If issuance must scale beyond one process,
  pre-allocate blocks of ids to workers (e.g. each worker takes
  `nextval` + 1000 and serves from its block). Never let two writers hand out
  from the same range.
- **Never reset, never reuse.** A returned or deleted record's id stays
  burned. Reuse makes one code name two records.

Fixed mode needs the same counter — this is not expandable-specific. What
expandable removes is the capacity planning around it: with a fixed profile
the counter must never outrun the profile's capacity, with an expandable one
it just keeps climbing and the code gains a symbol (spec 19).

## Store the id, never the code

A code is a derived rendering of the integer id under one specific profile.
The string you show a customer encodes today's choices — separator style,
alphabet, mode, profile id — and all of those can change while the id must
not. Storing the string couples your data to today's profile; storing the id
keeps every rendering decision reversible.

So the schema stores the integer:

```sql
CREATE TABLE orders (
  id         bigint PRIMARY KEY DEFAULT nextval('order_code_id'),
  account_id bigint NOT NULL REFERENCES accounts(id),
  ...
);
```

and the code exists only at the boundaries: render it in the view layer (see
"Framework view helpers" above), parse it in the controller. Nothing in
between ever sees the string.

If a code genuinely must be stored — a cache key, a search index, an
analytics export — treat it as a derived value: rebuildable from
`(id, profile_id)` at any time, safe to drop, and always written with the
profile id alongside it so a future reader knows which codec produced it.

## Parsing codes from untrusted input

The server-side counterpart of "Live input validation" above. `inspect()` is
client-side per-keystroke UX; do not reuse its graded states here. On the
server, pasted input is all-or-nothing: normalize away the noise, decode once,
and answer yes or no.

`decode` already strips whitespace and separators, upcases, and applies the
lookalike aliases (`O`/`I`/`L` and friends, spec 3.2) during normalization, so
the handler is short:

```python
from baseh import Baseh, BasehError, baseh_expandable_v1

codec = Baseh(baseh_expandable_v1())  # built once, at module level

def resolve_ticket(request):
    raw = request.form.get("code", "")
    try:
        ticket_id = codec.decode(raw, accept_spaces=True).id
        ticket = Ticket.query.get(ticket_id)
        if ticket is None or ticket.account_id != current_account().id:
            raise LookupError  # same response as a bad code
    except BasehError as e:
        log.info("decode failed", extra={"reason": e.code})  # internal detail
        raise LookupError from e
    except LookupError:
        return render_template("not_found.html"), 404
    return render_template("ticket.html", ticket=ticket)
```

One undifferentiated failure to the caller. A typed code can fail because it
is malformed, because it belongs to a different namespace, or because the
record is not the caller's — never reveal which check failed; each distinct
answer is an enumeration oracle. Branch logging and metrics on `e.code`
internally, where it costs nothing.

Rate-limit the endpoint the same way as any public lookup (see the security
checklist below); decode is cheap arithmetic, so the database query behind it
is what you are protecting.

## Rotating keys on a keyed (-p) tier

On a `-p` profile the caller-supplied key shuffles the presentation of codes.
Rotation is therefore hygiene and compartmentalization — limiting how long
one key's worth of issued codes stays valid-looking — not an emergency brake.
The docs are explicit that the permutation is not encryption, and rotation
does not change that: an old key that leaks still decodes its era's codes.
Rotate on a schedule, not in a panic.

The pattern: issue under the current key only, decode against a small
registry of live keys tried in order, retire key ids once traffic drains.

```typescript
import { Baseh, BasehError, basehExpandablePV1 } from "@cloudyventures/baseh";

const KEYS: Record<string, Uint8Array> = {
  "prod-02": currentKeyBytes,   // issuing key
  "prod-01": previousKeyBytes,  // draining; remove when traffic hits zero
};
const CURRENT = "prod-02";

const issuer = new Baseh(basehExpandablePV1({ keyBytes: KEYS[CURRENT], keyId: CURRENT }));
const decoders = Object.entries(KEYS).map(
  ([keyId, keyBytes]) => new Baseh(basehExpandablePV1({ keyBytes, keyId })),
);

export function issue(id: bigint): string {
  return issuer.encode(id);
}

export function resolve(code: string): bigint {
  for (const d of decoders) {
    try {
      return d.decode(code, { acceptSpaces: true }).id;
    } catch (e) {
      if (!(e instanceof BasehError) || e.code !== "INVALID_CHECKSUM") throw e;
    }
  }
  throw new BasehError("INVALID_CHECKSUM", "The reference code did not pass validation");
}
```

Keep the registry small — two or three key ids — and order it current-first so
the common case is one decode. A code from an older era fails the current
key's checksum and falls through to its own key; anything else fails the same
way at the end of the list, so the caller still sees one undifferentiated
error. When metrics show no successful decodes under `prod-01` for a full
traffic cycle, delete it from `KEYS`.

## Running two profiles during a migration (fixed mode)

The `orders-v1` to `orders-v2` migration from the README, made concrete. When
a fixed profile outgrows its capacity, the next profile keeps everything and
stretches the body — so old and new codes differ in width, and that width is
the router. Both profiles stay registered forever; old codes keep decoding.

```ruby
module OrderCodes
  V1 = Baseh::Baseh.new(Baseh.baseh_medium_v1)  # 8 symbols: body 6 + checksum 2
  V2 = Baseh::Baseh.new(                        # 9 symbols: body 7 + checksum 2
    Baseh.baseh_medium_v1.tap do |p|
      p[:profile_id] = "orders-v2"
      p[:body_length] = 7
      p[:grouping] = [5, 4]
    end
  )
  ROUTES = { 8 => V1, 9 => V2 }.freeze

  def self.decode(input)
    cleaned = input.gsub(/[\s-]/, "")
    codec = ROUTES[cleaned.length] or
      raise Baseh::BasehError.new("INVALID_LENGTH", "Unknown reference length")
    codec.decode(input).id   # wrong profile -> INVALID_CHECKSUM, loudly
  end
end
```

The checksum is domain-separated by profile id (spec 6.2), so the router is not
a security boundary — a code guessed at the wrong length, or hand-edited into
the other profile's width, fails validation instead of silently resolving to
the wrong record. Normalize before dispatch (the `gsub` above) so separators
and pasted whitespace do not corrupt the length check.

The same routing works for expandable profiles, but a migration there is
usually unnecessary: within one expandable profile, length already selects the
generation (spec 19), so the profile stretches itself and `orders-v2` never
has to exist.

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
