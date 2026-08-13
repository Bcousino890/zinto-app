import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";
import type { ErpReadRepository, ErpResource } from "../src/resources/erp-read.js";

const raw = `pcp_${"e".repeat(64)}`;
const hash = createHash("sha256").update(raw.slice(4)).digest("hex");
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const key: ApiKeyRecord = { id: 4, companyId: 77, companyName: "SmartBC", userId: 9, name: "erp", keyHash: hash, permissions: ["erp:read", "inventory:read"], isActive: true, expiresAt: null, allowedIps: [] };
class Keys implements ApiKeyRepository { async findByHash(value: string) { return value === hash ? key : null; } async markUsed() {} }
class Repo implements ErpReadRepository { calls: Array<[number, ErpResource]> = []; async list(companyId: number, resource: ErpResource) { this.calls.push([companyId, resource]); return { items: [], nextCursor: null, hasMore: false }; } }
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe("ERP read API", () => {
  it("uses the API-key tenant and paginated responses", async () => {
    const repo = new Repo(); const app = await buildApp({ apiKeyRepository: new Keys(), erpReadRepository: repo, logger: false }); apps.push(app);
    for (const path of ["products", "inventory/warehouses", "inventory/stock-levels", "suppliers", "sales-orders", "purchase-orders", "invoices"]) {
      const response = await app.inject({ method: "GET", url: `/api/v1/erp/${path}?limit=10`, headers: { authorization: `Bearer ${raw}` } });
      expect(response.statusCode).toBe(200); expect(response.json().meta).toEqual(expect.objectContaining({ has_more: false, next_cursor: null }));
    }
    expect(repo.calls).toHaveLength(7); expect(new Set(repo.calls.map(([company]) => company))).toEqual(new Set([77]));
  });
  it("requires ERP and inventory scopes separately", async () => {
    const noErp: ApiKeyRepository = { findByHash: async () => ({ ...key, permissions: ["inventory:read"] }), markUsed: async () => {} };
    const app = await buildApp({ apiKeyRepository: noErp, erpReadRepository: new Repo(), logger: false }); apps.push(app);
    expect((await app.inject({ method: "GET", url: "/api/v1/erp/products", headers: { authorization: `Bearer ${raw}` } })).statusCode).toBe(403);
    const noInventory: ApiKeyRepository = { findByHash: async () => ({ ...key, permissions: ["erp:read"] }), markUsed: async () => {} };
    const inventoryApp = await buildApp({ apiKeyRepository: noInventory, erpReadRepository: new Repo(), logger: false }); apps.push(inventoryApp);
    expect((await inventoryApp.inject({ method: "GET", url: "/api/v1/erp/inventory/warehouses", headers: { authorization: `Bearer ${raw}` } })).statusCode).toBe(403);
  });
  it("does not expose ERP mutations", async () => { const app = await buildApp({ apiKeyRepository: new Keys(), erpReadRepository: new Repo(), logger: false }); apps.push(app); expect(app.printRoutes()).not.toContain("POST /api/v1/erp"); });
});
