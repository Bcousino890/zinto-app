import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ApiKeyRepository } from "../src/auth/api-key.js";
import type { FlowRepository } from "../src/resources/flows.js";

const rawKey = `pcp_${"a".repeat(64)}`;
const hash = createHash("sha256").update(rawKey.slice(4)).digest("hex");
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

const apiKeys: ApiKeyRepository = {
  async findByHash(value) {
    return value === hash ? { id: 1, companyId: 12, companyName: "Caller", userId: 4,
      name: "flows", keyHash: hash, permissions: ["flows:read"], isActive: true,
      expiresAt: null, allowedIps: [] } : null;
  },
  async markUsed() {}
};

const page = { items: [], hasMore: false, nextCursor: null };
const resources: FlowRepository = {
  async listFlows(companyId) {
    expect(companyId).toBe(12);
    return { ...page, items: [{ id: "7", created_by_user_id: "4", name: "Cobro",
      description: null, status: "active", version: 3, created_at: "2026-08-10T10:00:00.000Z",
      updated_at: "2026-08-11T10:00:00.000Z" }] };
  },
  async findFlow(companyId, id) { return companyId === 12 && id === 7 ? (await this.listFlows(companyId, { cursor: null, limit: 1, updatedSince: null })).items[0]! : null; },
  async listAssignments() { return page; },
  async listExecutions() { return page; }
};

afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe("flow read routes", () => {
  it("requires flows:read and never accepts company_id from the caller", async () => {
    const app = await buildApp({ apiKeyRepository: apiKeys, flowRepository: resources, logger: false });
    apps.push(app);
    const headers = { authorization: `Bearer ${rawKey}` };

    expect((await app.inject({ method: "GET", url: "/api/v1/flows", headers })).statusCode).toBe(200);
    const rejected = await app.inject({ method: "GET", url: "/api/v1/flows?company_id=77", headers });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe("validation_error");
  });

  it("returns an opaque 404 for a flow outside the tenant", async () => {
    const app = await buildApp({ apiKeyRepository: apiKeys, flowRepository: resources, logger: false });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/v1/flows/99",
      headers: { authorization: `Bearer ${rawKey}` } });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("flow_not_found");
  });
});
