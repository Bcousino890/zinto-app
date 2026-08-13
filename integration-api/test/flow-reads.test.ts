import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";
import type { FlowReadRepository } from "../src/resources/flow-reads.js";

const raw = `pcp_${"f".repeat(64)}`;
const hash = createHash("sha256").update(raw.slice(4)).digest("hex");
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const key: ApiKeyRecord = { id: 1, companyId: 10, companyName: "Pilot", userId: 2, name: "flows", keyHash: hash, permissions: ["flows:read"], isActive: true, expiresAt: null, allowedIps: [] };
class Keys implements ApiKeyRepository { async findByHash(value: string) { return value === hash ? key : null; } async markUsed() {} }
class Repo implements FlowReadRepository {
  async listFlows(companyId: number, query: { limit: number }) { return { items: [{ id: "1", company_id: companyId, limit: query.limit }], nextCursor: null, hasMore: false } as never; }
  async findFlow(companyId: number, flowId: number) { return flowId === 1 && companyId === 10 ? { id: "1" } as never : null; }
  async listSessions(companyId: number, flowId: number) { return companyId === 10 && flowId === 1 ? { items: [], nextCursor: null, hasMore: false } : null; }
  async listExecutions(companyId: number, flowId: number) { return companyId === 10 && flowId === 1 ? { items: [], nextCursor: null, hasMore: false } : null; }
  async listTemplates() { return { items: [{ id: "1", business_type: "retail" }], nextCursor: null, hasMore: false } as never; }
}
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe("Flow read API", () => {
  it("requires flows:read and exposes paginated company flows", async () => {
    const app = await buildApp({ apiKeyRepository: new Keys(), flowReadRepository: new Repo(), logger: false }); apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/v1/flows?limit=10", headers: { authorization: `Bearer ${raw}` } });
    expect(response.statusCode).toBe(200); expect(response.json().meta).toEqual({ request_id: expect.any(String), next_cursor: null, has_more: false }); expect(response.json().data[0].company_id).toBe(10);
  });
  it("returns tenant-safe 404 for a flow owned by another company", async () => {
    const app = await buildApp({ apiKeyRepository: new Keys(), flowReadRepository: new Repo(), logger: false }); apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/v1/flows/99/sessions", headers: { authorization: `Bearer ${raw}` } });
    expect(response.statusCode).toBe(404); expect(response.json().error.code).toBe("flow_not_found");
  });
  it("does not register flow mutations", async () => {
    const app = await buildApp({ apiKeyRepository: new Keys(), flowReadRepository: new Repo(), logger: false }); apps.push(app);
    expect(app.printRoutes()).not.toContain("POST /api/v1/flows");
  });
});
