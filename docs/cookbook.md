# HRC Application Cookbook

Application-level guidance for hosting an HRC lookup. These patterns are not part
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
