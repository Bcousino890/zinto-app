# Flows read API audit

## Scope

This change implements read-only partner access for `flows`, `flow_sessions`,
`flow_executions`, and the global `flow_templates` catalog. It does not add
Flow mutations, ERP routes, migrations, or deployment changes.

## Schema evidence

The local source backup defines `company_id` on `flows`, `flow_sessions`, and
`flow_executions`. The API therefore filters each operational query by the
authenticated API-key company and never accepts `company_id` from the caller.
The flow-specific session and execution routes first verify ownership through
`flows`, so an ID from another company returns the same not-found result as an
unknown flow.

`flow_templates` has no `company_id` in the source schema and is seeded as a
shared catalog. It is exposed separately as active global templates; it is not
treated as private company data.

## Contract

All routes require the `flows:read` scope and use the existing opaque cursor
pagination contract:

- `GET /api/v1/flows`
- `GET /api/v1/flows/{id}`
- `GET /api/v1/flows/{id}/sessions`
- `GET /api/v1/flows/{id}/executions`
- `GET /api/v1/flow-templates`

No `POST`, `PUT`, `PATCH`, or `DELETE` Flow route is registered.

## Verification

- Tenant and scope tests added in `test/flow-reads.test.ts`.
- OpenAPI route parity and schema validation pass.
- Full suite: 474 tests passing.
- Typecheck and build pass.
- No migration was applied and no VPS or production process was touched.
