# Flows and ERP Scope Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose only schema-verified, tenant-safe read access for the minimum useful Flows and ERP integration surface, and close every unsupported write with an explicit contract and activation checklist.

**Architecture:** Add separate Fastify repositories and routes for Flows and ERP, with `company_id` supplied exclusively by the authenticated API principal. Parentless child tables are read only through a join to a company-scoped parent; sensitive flow JSON and ERP write semantics remain outside the API. No database migration or mutation route is added.

**Tech Stack:** TypeScript, Fastify 5, PostgreSQL, Zod, Vitest, OpenAPI 3.1, Markdown

**Spec:** `docs/api/INTEGRATION-API-DESIGN.md`, `migrations/001-initial-schema.sql`, and ERP migrations `150` through `202`

## Global Constraints

- Work only in the isolated `codex/flows-erp-scope-close` worktree.
- Do not access, change, or deploy production.
- Never accept `company_id` from a request; derive it from the authenticated API key.
- Do not expose flow `nodes`, `edges`, custom/session variables, context data, debug data, or error messages.
- Do not add Flows or ERP writes, outbox events, webhook event claims, or business migrations.
- Serialize integer references as strings and PostgreSQL numeric values as decimal strings.

---

### Task 1: Flows read boundary

**Files:**
- Create: `integration-api/src/resources/flows.ts`
- Create: `integration-api/src/routes/flows.ts`
- Create: `integration-api/test/flow-repository.test.ts`
- Create: `integration-api/test/flow-resources.test.ts`
- Modify: `integration-api/src/app.ts`
- Modify: `integration-api/src/server.ts`

**Interfaces:**
- Consumes: authenticated `companyId`, opaque cursor pagination, `flows`, `flow_assignments`, `channel_connections`, and `flow_executions` columns proven by migrations.
- Produces: `FlowRepository.listFlows`, `findFlow`, `listAssignments`, and `listExecutions`; GET routes `/api/v1/flows`, `/api/v1/flows/{id}`, `/api/v1/flows/{id}/assignments`, and `/api/v1/flow-executions` under `flows:read`.

- [ ] **Step 1: Write repository and route tests that fail because the interfaces do not exist**

Assert strict `flows.company_id = $1`, tenant-scoped joins for assignments/executions, opaque cross-tenant `404`, exact `flows:read` enforcement, pagination, and omission of sensitive JSON.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- test/flow-repository.test.ts test/flow-resources.test.ts`

Expected: FAIL because `resources/flows.ts` and route wiring do not exist.

- [ ] **Step 3: Implement the minimum read-only repository and routes**

Return flow metadata (`id`, `name`, `description`, `status`, `version`, creator and timestamps), assignments (`id`, `flow_id`, `channel_id`, `active`, timestamps), and execution lifecycle metadata without payload/context/error fields.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- test/flow-repository.test.ts test/flow-resources.test.ts`

Expected: all focused tests pass.

### Task 2: ERP read boundary

**Files:**
- Create: `integration-api/src/resources/erp.ts`
- Create: `integration-api/src/routes/erp.ts`
- Create: `integration-api/test/erp-repository.test.ts`
- Create: `integration-api/test/erp-resources.test.ts`
- Modify: `integration-api/src/app.ts`
- Modify: `integration-api/src/server.ts`

**Interfaces:**
- Consumes: authenticated `companyId`, opaque cursor pagination, and migration-proven columns on `products`, `stock_levels`, `warehouses`, `sales_orders`, and `invoices`.
- Produces: GET `/api/v1/erp/products[/{id}]` under `erp.products:read`, `/api/v1/erp/stock-levels` under `erp.inventory:read`, `/api/v1/erp/sales-orders[/{id}]` under `erp.sales-orders:read`, and `/api/v1/erp/invoices[/{id}]` under `erp.invoices:read`.

- [ ] **Step 1: Write repository and route tests that fail because the interfaces do not exist**

Assert strict company filters, same-company joins for stock references, opaque detail `404`, decimal-string serialization, scope checks, filters, and rejection of `company_id` query input.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- test/erp-repository.test.ts test/erp-resources.test.ts`

Expected: FAIL because `resources/erp.ts` and route wiring do not exist.

- [ ] **Step 3: Implement the minimum read-only repository and routes**

Expose stable operational fields only. Exclude product custom fields/images, addresses, notes, invoice PDF URLs, line items, payments, accounting postings, and all mutations.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- test/erp-repository.test.ts test/erp-resources.test.ts`

Expected: all focused tests pass.

### Task 3: Machine-readable and human contract closure

**Files:**
- Modify: `integration-api/test/openapi.test.ts`
- Modify: `integration-api/openapi/openapi.yaml`
- Create: `integration-api/docs/FLOWS-ERP-SCOPE-CLOSURE.md`
- Modify: `integration-api/docs/GETTING-STARTED.md`

**Interfaces:**
- Consumes: implemented runtime paths, exact scopes, migration evidence, and the read-only safety boundary.
- Produces: validated OpenAPI operations/schemas plus a final matrix of ready reads, blocked writes, required transaction/outbox contracts, and an exact staging activation checklist.

- [ ] **Step 1: Add failing OpenAPI assertions**

Assert all new paths, methods, tags, scopes, decimal strings, and the absence of POST/PATCH/PUT/DELETE on every Flows/ERP path.

- [ ] **Step 2: Run the OpenAPI test and verify RED**

Run: `npm test -- test/openapi.test.ts`

Expected: FAIL because the paths and schemas are absent.

- [ ] **Step 3: Add OpenAPI and closure documentation**

Document the exact read contract; separately list write preconditions for schema confirmation, audit actor, idempotency, transaction boundaries, tenant-composite references, outbox event definitions, staging restore tests, reconciliation, rollback, and explicit owner sign-off.

- [ ] **Step 4: Run OpenAPI validation and verify GREEN**

Run: `npm test -- test/openapi.test.ts`

Expected: SwaggerParser validates the document and all contract assertions pass.

### Task 4: Full verification and commit

**Files:**
- Verify all changed files.

**Interfaces:**
- Consumes: completed code, tests, OpenAPI, and closure report.
- Produces: one reviewed commit on `codex/flows-erp-scope-close`.

- [ ] **Step 1: Run full verification**

Run: `npm test && npm run typecheck && npm run build && git diff --check`

Expected: all commands exit zero.

- [ ] **Step 2: Audit tenant and write boundaries**

Run: `rg -n 'company_id|app\.(post|patch|put|delete)' src/resources/flows.ts src/resources/erp.ts src/routes/flows.ts src/routes/erp.ts`

Expected: every SQL root is company-scoped and no write route exists.

- [ ] **Step 3: Review and commit**

Run: `git diff --stat && git diff --check && git status --short`, then commit all scoped files as `feat(api): close safe Flows and ERP read scope`.

- [ ] **Step 4: Report evidence and remaining blocks**

Return the commit hash, branch/worktree, verification counts, implemented read contract, and intentionally blocked writes. State explicitly that production was not accessed or changed.
