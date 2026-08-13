import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";
import type { IdempotencyRecord, IdempotencyRepository, IdempotencyScope } from "../src/http/idempotency.js";
import type { PipelineCrudRepository } from "../src/resources/pipeline-crud.js";

const raw = `pcp_${"a".repeat(64)}`;
const hash = createHash("sha256").update(raw.slice(4)).digest("hex");
const key: ApiKeyRecord = { id: 7, companyId: 12, companyName: "Pilot", userId: 9, name: "test", keyHash: hash, permissions: ["pipelines:write"], isActive: true, expiresAt: null, allowedIps: [] };
class Keys implements ApiKeyRepository { async findByHash(value: string) { return value === hash ? key : null; } async markUsed() {} }
class Idem implements IdempotencyRepository { rows = new Map<string, IdempotencyRecord>(); key(s: IdempotencyScope) { return `${s.apiKeyId}:${s.method}:${s.path}:${s.key}`; } async find(s: IdempotencyScope) { return this.rows.get(this.key(s)) ?? null; } async save(s: IdempotencyScope, r: IdempotencyRecord) { this.rows.set(this.key(s), r); } async runExclusive<T>(_s: IdempotencyScope, fn: () => Promise<T>) { return fn(); } }
class Repo implements PipelineCrudRepository { calls = 0; async createPipeline() { this.calls++; return {} as never; } async updatePipeline() { this.calls++; return null; } async deletePipeline() { this.calls++; return { ok: false as const, reason: "pipeline_not_found" as const }; } async createStage() { this.calls++; return null; } async updateStage() { this.calls++; return null; } async deleteStage() { this.calls++; return { ok: false as const, reason: "stage_not_found" as const }; } }
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
async function make(readOnly = false, allow = false) { const repo = new Repo(); const app = await buildApp({ apiKeyRepository: new Keys(), idempotencyRepository: new Idem(), pipelineCrudRepository: repo, logger: false, readOnly, writeEnabledApiKeyIds: new Set(allow ? [key.id] : []) }); apps.push(app); return { app, repo }; }
const headers = { authorization: `Bearer ${raw}`, "idempotency-key": "pipeline-1" };
describe("pipeline CRUD route guards", () => {
  it("requires the idempotency key and never reaches the repository", async () => { const { app, repo } = await make(false); const response = await app.inject({ method: "POST", url: "/api/v1/pipelines", headers: { authorization: headers.authorization }, payload: { name: "Ventas" } }); expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe("idempotency_key_required"); expect(repo.calls).toBe(0); });
  it("allows an explicitly enabled key while global read-only remains on", async () => { const { app, repo } = await make(true, true); const response = await app.inject({ method: "POST", url: "/api/v1/pipelines", headers, payload: { name: "Ventas" } }); expect(response.statusCode).toBe(201); expect(repo.calls).toBe(1); });
  it("rejects unsafe pipeline IDs before the repository", async () => { const { app, repo } = await make(false); const response = await app.inject({ method: "PATCH", url: "/api/v1/pipelines/9007199254740992", headers, payload: { name: "x" } }); expect(response.statusCode).toBe(400); expect(repo.calls).toBe(0); });
  it("does not reveal a pipeline outside the company", async () => { const { app, repo } = await make(false); const response = await app.inject({ method: "PATCH", url: "/api/v1/pipelines/55", headers, payload: { name: "x" } }); expect(response.statusCode).toBe(404); expect(response.json().error.code).toBe("pipeline_not_found"); expect(repo.calls).toBe(1); });
});
