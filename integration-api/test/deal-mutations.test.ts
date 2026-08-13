import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";
import type { IdempotencyRecord, IdempotencyRepository, IdempotencyScope } from "../src/http/idempotency.js";
import type { DealCreateInput, DealMutationRepository, DealMutationResult, DealUpdateInput } from "../src/resources/deal-mutations.js";
import type { DealResource } from "../src/resources/pipelines.js";

const raw = `pcp_${"e".repeat(64)}`;
const hash = createHash("sha256").update(raw.slice(4)).digest("hex");
const key: ApiKeyRecord = { id: 4, companyId: 12, companyName: "Pilot", userId: 9, name: "deals", keyHash: hash, permissions: ["deals:write"], isActive: true, expiresAt: null, allowedIps: [] };
class Keys implements ApiKeyRepository { async findByHash(value: string) { return value === hash ? key : null; } async markUsed() {} }
class Idem implements IdempotencyRepository { rows = new Map<string, IdempotencyRecord>(); key(s: IdempotencyScope) { return `${s.apiKeyId}:${s.method}:${s.path}:${s.key}`; } async find(s: IdempotencyScope) { return this.rows.get(this.key(s)) ?? null; } async save(s: IdempotencyScope, r: IdempotencyRecord) { this.rows.set(this.key(s), r); } async runExclusive<T>(_s: IdempotencyScope, fn: () => Promise<T>) { return fn(); } }
const deal: DealResource = { id: "20", pipeline_id: "2", contact_id: "30", title: "Venta", stage_key: "lead", stage_id: "4", stage_name: "Nuevo", value: null, priority: "medium", status: "active", due_date: null, assigned_to_user_id: null, description: null, tags: [], custom_fields: {}, last_activity_at: null, created_at: "2026-08-13T00:00:00.000Z", updated_at: "2026-08-13T00:00:00.000Z" };
class Repo implements DealMutationRepository { calls: string[] = []; result: DealMutationResult = { ok: true, deal }; async createDeal(_c: number, _u: number, _i: DealCreateInput) { this.calls.push("create"); return this.result; } async updateDeal(_c: number, _i: number, _u: number, _v: DealUpdateInput) { this.calls.push("update"); return this.result; } async deleteDeal() { this.calls.push("delete"); return this.result; } async moveDeal() { this.calls.push("move"); return this.result; } }
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
async function make(readOnly = false, enabled = false) { const repo = new Repo(); const app = await buildApp({ apiKeyRepository: new Keys(), dealMutationRepository: repo, idempotencyRepository: new Idem(), logger: false, readOnly, writeEnabledApiKeyIds: new Set(enabled ? [key.id] : []) }); apps.push(app); return { app, repo }; }
const auth = { authorization: `Bearer ${raw}`, "idempotency-key": "deal-1" };
describe("deal mutation route guards", () => {
  it("creates with the required scope and idempotency", async () => { const { app, repo } = await make(); const response = await app.inject({ method: "POST", url: "/api/v1/deals", headers: auth, payload: { contact_id: "30", pipeline_id: "2", stage_id: "4", title: "Venta" } }); expect(response.statusCode).toBe(201); expect(repo.calls).toEqual(["create"]); });
  it("requires idempotency before repository access", async () => { const { app, repo } = await make(); const response = await app.inject({ method: "POST", url: "/api/v1/deals", headers: { authorization: auth.authorization }, payload: { contact_id: "30", pipeline_id: "2", stage_id: "4", title: "Venta" } }); expect(response.statusCode).toBe(400); expect(repo.calls).toEqual([]); });
  it("rejects unsafe IDs before repository access", async () => { const { app, repo } = await make(); const response = await app.inject({ method: "POST", url: "/api/v1/deals/9007199254740992/move", headers: auth, payload: { pipeline_id: "2", stage_id: "4" } }); expect(response.statusCode).toBe(400); expect(repo.calls).toEqual([]); });
  it("allows an explicitly enabled key while global read-only is on", async () => { const { app, repo } = await make(true, true); const response = await app.inject({ method: "PATCH", url: "/api/v1/deals/20", headers: auth, payload: { title: "Actualizado" } }); expect(response.statusCode).toBe(200); expect(repo.calls).toEqual(["update"]); });
  it("returns a tenant-safe not-found error from the repository", async () => { const { app, repo } = await make(); repo.result = { ok: false, reason: "deal_not_found" }; const response = await app.inject({ method: "DELETE", url: "/api/v1/deals/20", headers: auth }); expect(response.statusCode).toBe(404); expect(response.json().error.code).toBe("deal_not_found"); });
});
