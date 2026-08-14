# SmartBC and Events/Outbox Integration Close Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Combine the completed SmartBC compatibility and bidirectional events/outbox work into one reviewed, verified commit without deploying or applying migrations.

**Architecture:** Start from the events snapshot because it is the superset of the two unrelated root snapshots, import the complete events working-tree delta, then apply the SmartBC commit. Resolve the five overlapping contract and documentation files semantically so both compatibility aliases and durable event behavior remain represented.

**Tech Stack:** Node.js, TypeScript, Fastify, PostgreSQL SQL migrations, Vitest, OpenAPI 3.1.

**Spec:** User-provided integration-close request dated 2026-08-14.

## Global Constraints

- Work only in `/Users/benjamincousino/Documents/ChatGPT/codigo fuente zinto crm-integration-close`.
- Preserve all valid changes from both source worktrees.
- Do not deploy to VPS or apply a real database migration.
- Finish with one consolidated commit based on `66af9cc`.

---

### Task 1: Import Events and Outbox

**Files:**
- Modify: `docs/api/INTEGRATION-API-DESIGN.md`
- Modify: `integration-api/docs/GETTING-STARTED.md`
- Modify: `integration-api/docs/WEBHOOKS.md`
- Create: `integration-api/docs/REPLAY-RESYNC.md`
- Create: `integration-api/migrations/003_bidirectional_events_outbox.sql`
- Modify: `integration-api/openapi/openapi.yaml`
- Modify: `integration-api/src/resources/contact-mutations.ts`
- Modify: `integration-api/src/routes/webhooks.ts`
- Modify: `integration-api/src/webhooks/deliveries.ts`
- Modify: `integration-api/src/webhooks/dispatcher.ts`
- Create: `integration-api/src/webhooks/event-types.ts`
- Modify/Create: event, migration, OpenAPI, outbox, and webhook tests under `integration-api/test/`

**Interfaces:**
- Consumes: baseline integration API at `66af9cc`.
- Produces: canonical event types, transactional outbox rows, replay/resync documentation, and event migration coverage.

- [x] **Step 1: Import the exact tracked diff and all untracked event files from the completed source worktree.**
- [x] **Step 2: Run `npm test` in `integration-api` and confirm the imported event tests pass.**
- [x] **Step 3: Commit the imported layer temporarily so SmartBC can be merged with normal conflict tooling.**

### Task 2: Integrate SmartBC Compatibility

**Files:**
- Create: `integration-api/docs/SMARTBC-COMPATIBILITY.md`
- Modify: `integration-api/docs/AUTHENTICATION.md`
- Modify: `integration-api/docs/GETTING-STARTED.md`
- Modify: `integration-api/docs/WEBHOOKS.md`
- Modify: `integration-api/examples/node-client.ts`
- Modify: `integration-api/examples/webhook-receiver.ts`
- Modify: `integration-api/openapi/openapi.yaml`
- Modify: `integration-api/test/openapi.test.ts`
- Modify: `integration-api/test/outbox.test.ts`
- Modify: `integration-api/tsconfig.json`

**Interfaces:**
- Consumes: the event/outbox layer from Task 1.
- Produces: SmartBC-compatible auth, aliases, payload examples, and contract assertions without weakening canonical event semantics.

- [x] **Step 1: Cherry-pick `3687290` and identify every conflict.**
- [x] **Step 2: Resolve OpenAPI and tests by retaining assertions and schema additions from both works.**
- [x] **Step 3: Resolve documentation by retaining SmartBC compatibility guidance plus replay and event catalog guidance.**
- [x] **Step 4: Review the combined diff for dropped hunks, duplicate definitions, unsafe SQL, and contract inconsistencies.**

### Task 3: Verify and Consolidate

**Files:**
- Verify: all files changed since `66af9cc`.

**Interfaces:**
- Consumes: combined implementation from Tasks 1 and 2.
- Produces: one clean, reproducible integration commit.

- [x] **Step 1: Run the complete `integration-api` Vitest suite.**
- [x] **Step 2: Run `npm run typecheck` and `npm run build` in `integration-api`.**
- [x] **Step 3: Install root dependencies with `npm ci`, then run `npm run check` and `npm run build`.**
- [x] **Step 4: Run whitespace, conflict-marker, status, and name-status diff checks.**
- [ ] **Step 5: Soft-reset temporary integration commits to `66af9cc` and create one consolidated commit.**
- [ ] **Step 6: Re-run final diff/status checks and record the commit hash and verification evidence.**
