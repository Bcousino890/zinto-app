# Bidirectional Events Outbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit truthful, tenant-safe, versioned webhook events for CRM and Integration API mutations, prioritizing deals, pipelines, tasks, operational ERP, and Flows.

**Architecture:** PostgreSQL row triggers are the single transactional source of outbox events regardless of writer. A database event catalog constrains the public subscription list, while the worker fans out each outbox row once to tenant-matching endpoints and delivers at least once with stable event IDs.

**Tech Stack:** PostgreSQL/PLpgSQL, TypeScript 5.9, Fastify 5, `pg`, Vitest, OpenAPI 3.1.

**Spec:** `docs/CLAUDE-HANDOFF-INTEGRATION-API-2026-08-13.md`

## Global Constraints

- Do not deploy or apply migrations to production.
- Do not advertise an event unless an installed trigger can emit it.
- Every payload has an outbox-backed positive `schema_version`.
- Every write and delivery fan-out remains scoped by `company_id`.
- Delivery is at least once; consumers deduplicate by stable `X-Zinto-Event-Id`.
- Migrations are additive, idempotent, and safe to run after `001_integration_api.sql`.

---

### Task 1: Dispatcher Contract and Lease Recovery

**Files:**
- Modify: `integration-api/test/outbox.test.ts`
- Modify: `integration-api/src/webhooks/dispatcher.ts`
- Modify: `integration-api/src/webhooks/deliveries.ts`

**Interfaces:**
- Consumes: `ClaimedWebhookDelivery` rows leased from PostgreSQL.
- Produces: a signed webhook envelope using the row's `schemaVersion`, and SQL that fans out once and reclaims expired leases.

- [ ] **Step 1: Write failing tests** for row-backed schema versions, exact headers/body, stable IDs across retries, bounded attempts, expired leases, active endpoint filtering, and tenant-scoped fan-out.
- [ ] **Step 2: Run `npm test -- --run test/outbox.test.ts`** and confirm failures are caused by missing schema propagation and SQL guarantees.
- [ ] **Step 3: Implement the minimal dispatcher and repository changes** while preserving the documented HMAC input `<timestamp>.<rawBody>`.
- [ ] **Step 4: Run the focused test and `npm run typecheck`** until both pass.

### Task 2: Transactional Event Migration

**Files:**
- Create: `integration-api/migrations/003_bidirectional_events_outbox.sql`
- Create: `integration-api/test/event-migration.test.ts`
- Modify: `integration-api/src/resources/contact-mutations.ts`

**Interfaces:**
- Consumes: legacy CRM tables plus `integration_api_outbox` from migration 001.
- Produces: `integration_api_event_catalog`, `integration_api_enqueue_event(...)`, and row triggers for contacts, notes, deals, pipelines/stages, tasks, ERP, and Flows.

- [ ] **Step 1: Write failing migration contract tests** that assert additive DDL, idempotent trigger installation, tenant extraction, no-op suppression, safe payload projections, and all required event families.
- [ ] **Step 2: Run `npm test -- --run test/event-migration.test.ts`** and verify the migration is absent.
- [ ] **Step 3: Add migration 003** with catalogued schema-v1 events, optional deduplication keys, transactional enqueue, and table-existence guards.
- [ ] **Step 4: Remove direct API outbox inserts** while retaining API audit records and API-origin session metadata, so triggers emit exactly once in the same entity transaction.
- [ ] **Step 5: Run focused tests and validate the SQL against an ephemeral PostgreSQL instance** when Docker is available.

### Task 3: Truthful Public Contract and Operations

**Files:**
- Create: `integration-api/src/webhooks/event-types.ts`
- Modify: `integration-api/src/routes/webhooks.ts`
- Modify: `integration-api/openapi/openapi.yaml`
- Modify: `integration-api/docs/WEBHOOKS.md`
- Create: `integration-api/docs/REPLAY-RESYNC.md`
- Modify: `integration-api/test/webhooks.test.ts`
- Modify: `integration-api/test/openapi.test.ts`

**Interfaces:**
- Consumes: event types inserted by migration 002.
- Produces: one TypeScript subscription catalog, matching OpenAPI enum, payload documentation, and tenant-safe replay/resync runbooks.

- [ ] **Step 1: Write failing contract tests** comparing the TypeScript, SQL, and OpenAPI event catalogs.
- [ ] **Step 2: Run the focused tests** and confirm newly installed events are not yet public.
- [ ] **Step 3: Centralize and expose exactly the installed event types**, including payload schema version 1 and origin metadata.
- [ ] **Step 4: Document delivery semantics, deduplication, replay of an existing event, bounded resync, retention caveats, and tenant verification queries.**
- [ ] **Step 5: Run all tests, typecheck, build, migration validation, and inspect the final diff.**
