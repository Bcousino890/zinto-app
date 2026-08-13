# Zinto Integration API Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and document the first production-capable, tenant-safe foundation of Zinto's universal bidirectional Integration API.

**Architecture:** A standalone TypeScript service runs alongside the recovered CRM. It authenticates existing Zinto API keys against PostgreSQL, uses tenant-safe repositories for data, delegates channel delivery to the existing `/api/v1` engine, and publishes changes through a transactional outbox and signed webhooks.

**Tech Stack:** Node.js 20, TypeScript 5.6, Fastify, Zod, PostgreSQL 16, Vitest, OpenAPI 3.1, Docker Compose.

## Global Constraints

- Do not edit generated or recovered files inside `dist/`.
- Do not commit secrets, production data, active sessions, credentials, access IPs, or customer media.
- Every database query involving company data must include authenticated `company_id` scope.
- Use test-driven development: verify each new behavior fails before implementing it.
- Message delivery must use the current Zinto delivery adapter; never create a second WhatsApp socket.
- The public base path is `/api/v1` and breaking changes require a new API version.
- OpenAPI and written documentation must match executable request/response schemas.
- Production mutations remain disabled until staging integration tests pass.

---

### Task 1: Service Skeleton and Health Contract

**Files:**
- Create: `integration-api/package.json`
- Create: `integration-api/tsconfig.json`
- Create: `integration-api/src/config.ts`
- Create: `integration-api/src/app.ts`
- Create: `integration-api/src/server.ts`
- Create: `integration-api/src/http/errors.ts`
- Test: `integration-api/test/health.test.ts`

**Interfaces:**
- Produces: `buildApp(options?: AppOptions): Promise<FastifyInstance>`.
- Produces: `GET /health` returning service, version, and status without secrets.

- [ ] **Step 1: Write failing health and error-envelope tests.**
- [ ] **Step 2: Run `npm test -- health.test.ts` and confirm route-not-found failures.**
- [ ] **Step 3: Implement validated configuration, app factory, request IDs, health route, and canonical error envelope.**
- [ ] **Step 4: Run unit tests and TypeScript checking.**
- [ ] **Step 5: Commit `feat(api): add integration service foundation`.**

### Task 2: API-Key Authentication and Tenant Isolation

**Files:**
- Create: `integration-api/src/auth/api-key.ts`
- Create: `integration-api/src/auth/scopes.ts`
- Create: `integration-api/src/db/pool.ts`
- Create: `integration-api/src/db/api-keys.ts`
- Create: `integration-api/src/routes/me.ts`
- Test: `integration-api/test/auth.test.ts`
- Test: `integration-api/test/tenant-isolation.test.ts`

**Interfaces:**
- Produces: `authenticateApiKey(request): Promise<ApiPrincipal>`.
- Produces: `requireScopes(...scopes)` Fastify pre-handler.
- Produces: `GET /api/v1/me` with company and granted scopes.

- [ ] **Step 1: Write failing tests for missing, malformed, unknown, inactive, expired, IP-blocked, and valid keys.**
- [ ] **Step 2: Verify the tests fail because authentication is absent.**
- [ ] **Step 3: Implement `pcp_` hash compatibility, principal attachment, scope enforcement, and redacted logging.**
- [ ] **Step 4: Add two-company tests proving IDs cannot bypass tenant context.**
- [ ] **Step 5: Run all tests and commit `feat(api): authenticate tenant API keys`.**

### Task 3: Read-Only Core Resources

**Files:**
- Create: `integration-api/src/http/pagination.ts`
- Create: `integration-api/src/resources/channels.ts`
- Create: `integration-api/src/resources/contacts.ts`
- Create: `integration-api/src/resources/conversations.ts`
- Create: `integration-api/src/resources/messages.ts`
- Create: `integration-api/src/routes/core.ts`
- Test: `integration-api/test/core-resources.test.ts`

**Interfaces:**
- Produces: tenant-scoped `GET /api/v1/channels`.
- Produces: tenant-scoped cursor-paginated contacts, conversations, and messages.
- Produces: `GET /api/v1/conversations/:id/messages` with historical messages, not only current-day records.

- [ ] **Step 1: Write failing schema, pagination, history, and cross-company tests.**
- [ ] **Step 2: Confirm failures before repositories exist.**
- [ ] **Step 3: Implement keyset cursors and explicit field projections that exclude credentials.**
- [ ] **Step 4: Run tests against disposable PostgreSQL fixtures.**
- [ ] **Step 5: Commit `feat(api): expose tenant-safe core resources`.**

### Task 4: Contacts, Notes, and Tags Mutations

**Files:**
- Create: `integration-api/src/http/idempotency.ts`
- Create: `integration-api/src/resources/contact-mutations.ts`
- Create: `integration-api/src/resources/notes.ts`
- Create: `integration-api/src/resources/tags.ts`
- Create: `integration-api/migrations/001_integration_api.sql`
- Test: `integration-api/test/contact-mutations.test.ts`
- Test: `integration-api/test/idempotency.test.ts`

**Interfaces:**
- Produces: create/update/archive contact endpoints.
- Produces: create/update/delete notes and attach/detach tags.
- Produces: `withIdempotency(principal, request, operation)`.

- [ ] **Step 1: Write failing validation, uniqueness, idempotent replay, conflict, audit, and tenant tests.**
- [ ] **Step 2: Verify expected failures.**
- [ ] **Step 3: Add migration tables for idempotency records, audit records, event outbox, webhook endpoints, and webhook deliveries.**
- [ ] **Step 4: Implement mutations in transactions with audit and outbox writes.**
- [ ] **Step 5: Run migration and test suites, then commit `feat(api): synchronize contacts notes and tags`.**

### Task 5: Message Delivery Adapter

**Files:**
- Create: `integration-api/src/delivery/client.ts`
- Create: `integration-api/src/delivery/schemas.ts`
- Create: `integration-api/src/routes/message-send.ts`
- Test: `integration-api/test/message-send.test.ts`

**Interfaces:**
- Produces: text, media, template, batch, and interactive message routes.
- Consumes: current Zinto `/api/v1` with the caller's authorized API key.

- [ ] **Step 1: Write failing tests for channel selection, capability rejection, idempotent sends, adapter timeouts, and normalized errors.**
- [ ] **Step 2: Confirm the adapter tests fail before implementation.**
- [ ] **Step 3: Implement the localhost delivery adapter without storing plaintext keys.**
- [ ] **Step 4: Run contract tests against a fake legacy server and disposable database.**
- [ ] **Step 5: Commit `feat(api): delegate multichannel message delivery`.**

### Task 6: Bidirectional Outbox and Signed Webhooks

**Files:**
- Create: `integration-api/src/events/outbox.ts`
- Create: `integration-api/src/webhooks/signature.ts`
- Create: `integration-api/src/webhooks/dispatcher.ts`
- Create: `integration-api/src/routes/webhooks.ts`
- Test: `integration-api/test/webhooks.test.ts`
- Test: `integration-api/test/outbox.test.ts`

**Interfaces:**
- Produces: webhook registration, rotation, list, disable, replay, and test endpoints.
- Produces: `signWebhook(timestamp, rawBody, secret): string`.
- Produces: leased dispatcher with retry/backoff and dead-letter states.

- [ ] **Step 1: Write failing HMAC, timestamp, duplicate, retry, leasing, dead-letter, replay, and tenant tests.**
- [ ] **Step 2: Verify the failures identify missing behavior.**
- [ ] **Step 3: Implement transactional event claiming and signed HTTPS delivery.**
- [ ] **Step 4: Add safe database triggers for inbound messages and core legacy mutations, then test rollback behavior.**
- [ ] **Step 5: Run concurrency tests and commit `feat(api): deliver bidirectional webhooks`.**

### Task 7: OpenAPI and Partner Documentation

**Files:**
- Create: `integration-api/openapi/openapi.yaml`
- Create: `integration-api/docs/GETTING-STARTED.md`
- Create: `integration-api/docs/AUTHENTICATION.md`
- Create: `integration-api/docs/PAGINATION.md`
- Create: `integration-api/docs/IDEMPOTENCY.md`
- Create: `integration-api/docs/WEBHOOKS.md`
- Create: `integration-api/docs/ERRORS.md`
- Create: `integration-api/examples/node-client.ts`
- Create: `integration-api/examples/webhook-receiver.ts`
- Test: `integration-api/test/openapi.test.ts`

**Interfaces:**
- Produces: complete OpenAPI 3.1 contract for implemented foundation routes.
- Produces: executable examples for authentication, synchronization, and signature verification.

- [ ] **Step 1: Write a failing test that validates OpenAPI and compares documented operations to registered routes.**
- [ ] **Step 2: Confirm missing contract failures.**
- [ ] **Step 3: Document every field, scope, response, error, event, limit, and example for implemented routes.**
- [ ] **Step 4: Validate examples and OpenAPI in CI.**
- [ ] **Step 5: Commit `docs(api): publish partner integration contract`.**

### Task 8: Containers, CI, and Staging Verification

**Files:**
- Create: `integration-api/Dockerfile`
- Create: `integration-api/docker-compose.test.yml`
- Create: `.github/workflows/integration-api.yml`
- Create: `integration-api/scripts/smoke-test.ts`
- Test: `integration-api/test/integration/staging.test.ts`

**Interfaces:**
- Produces: reproducible build, migration, health, and smoke-test commands.

- [ ] **Step 1: Write failing container and staging smoke checks.**
- [ ] **Step 2: Build the isolated container and confirm the checks fail before configuration is complete.**
- [ ] **Step 3: Add non-root image, health check, read-only rollout mode, and CI gates.**
- [ ] **Step 4: Test against an anonymized restored database with message delivery disabled.**
- [ ] **Step 5: Commit `ci(api): verify reproducible integration service`.**

### Task 9: Independent Review and Release Gate

**Files:**
- Create: `integration-api/docs/RELEASE-CHECKLIST.md`
- Create: `integration-api/docs/SECURITY-MODEL.md`
- Create: `integration-api/docs/KNOWN-LIMITATIONS.md`

**Interfaces:**
- Produces: evidence-backed release decision and remediation record.

- [ ] **Step 1: Dispatch independent reviewers for security, tenant isolation, contract completeness, webhook reliability, and deployment reproducibility.**
- [ ] **Step 2: Reproduce every valid finding with a failing test.**
- [ ] **Step 3: Fix load-bearing findings and rerun scoped reviews.**
- [ ] **Step 4: Run the full test, typecheck, OpenAPI, build, restore, and smoke-test suite.**
- [ ] **Step 5: Record residual risks and commit `docs(api): add verified release gate`.**
