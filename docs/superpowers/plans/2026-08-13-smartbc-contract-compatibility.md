# SmartBC Contract Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Integration API contract unambiguous and machine-verifiable for SmartBC without changing or removing existing runtime behavior.

**Architecture:** Keep Fastify routes and accepted webhook event names unchanged. Strengthen the OpenAPI 3.1 document with exact per-operation scopes, outbound webhook headers/body, and current event availability; add a partner matrix that separates the proxy service root from the `/api/v1` resource base and distinguishes emitted events from reserved subscriptions.

**Tech Stack:** TypeScript, Fastify 5, Vitest, OpenAPI 3.1, YAML, Markdown

**Spec:** `docs/CLAUDE-HANDOFF-INTEGRATION-API-2026-08-13.md` and `docs/api/INTEGRATION-API-DESIGN.md`

## Global Constraints

- Work only in the isolated `codex/smartbc-compat` worktree.
- Preserve every existing route, accepted webhook event, header, and response shape.
- Do not access or deploy to the VPS.
- Do not add secrets, customer data, or live credentials.
- Follow test-first red/green verification for contract behavior.

---

### Task 1: Machine-verifiable SmartBC contract

**Files:**
- Modify: `integration-api/test/openapi.test.ts`
- Modify: `integration-api/openapi/openapi.yaml`

**Interfaces:**
- Consumes: existing OpenAPI paths and Fastify route contract.
- Produces: `x-required-scopes` arrays on protected operations and an OpenAPI outbound webhook operation.

- [ ] **Step 1: Add failing OpenAPI assertions**

Assert the literal service root, all operation-to-scope mappings, webhook request headers, webhook body schema, and currently emitted event list.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- test/openapi.test.ts`

Expected: failures for missing `x-required-scopes`, top-level `webhooks`, and event availability metadata.

- [ ] **Step 3: Add minimal OpenAPI metadata**

Add the exact extensions and webhook operation without changing paths, security scheme, or accepted event enum.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- test/openapi.test.ts`

Expected: all OpenAPI tests pass and SwaggerParser still validates the document.

### Task 2: SmartBC integration guide and examples

**Files:**
- Create: `integration-api/docs/SMARTBC-COMPATIBILITY.md`
- Modify: `integration-api/docs/GETTING-STARTED.md`
- Modify: `integration-api/docs/AUTHENTICATION.md`
- Modify: `integration-api/docs/WEBHOOKS.md`
- Modify: `integration-api/examples/node-client.ts`
- Modify: `integration-api/examples/webhook-receiver.ts`

**Interfaces:**
- Consumes: OpenAPI service root, paths, scopes, webhook headers, and event availability.
- Produces: a copy-safe partner matrix and examples that accept either a service-root or `/api/v1` base URL without duplicating path segments.

- [ ] **Step 1: Document the exact compatibility boundary**

Describe the service root, resource API base, health paths, all implemented operations and scopes, exact HMAC input, headers, payload, inbound-message semantics, and emitted versus reserved events.

- [ ] **Step 2: Correct existing guide ambiguities**

Document both public health endpoints, use a valid `req_` request ID, and link the SmartBC compatibility guide.

- [ ] **Step 3: Harden examples without secrets**

Normalize `ZINTO_API_URL` so both supported base forms work, add a contact-list example for reconciliation, and validate webhook event/header identity before processing.

- [ ] **Step 4: Typecheck examples with the project**

Run: `npm run typecheck`

Expected: zero TypeScript errors.

### Task 3: Full verification and commit

**Files:**
- Verify all changed files.

**Interfaces:**
- Consumes: completed contract, tests, guides, and examples.
- Produces: one reviewed compatibility commit on `codex/smartbc-compat`.

- [ ] **Step 1: Run full verification**

Run: `npm test && npm run typecheck && npm run build && git diff --check`

Expected: all tests pass, typecheck/build exit zero, and no whitespace errors.

- [ ] **Step 2: Audit the diff for secrets and unsafe behavior**

Confirm no runtime routes/events were removed, no VPS/deploy files changed, and no credential-like values were added.

- [ ] **Step 3: Commit the compatibility changes**

Run: `git add <changed files> && git commit -m "docs(api): align SmartBC integration contract"`

- [ ] **Step 4: Report evidence**

Return the commit hash, changed files, exact verification commands, test counts, and any intentionally unresolved runtime limitations.
