import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ApiKeyRepository } from "../src/auth/api-key.js";
import type { ErpRepository } from "../src/resources/erp.js";

const rawKey = `pcp_${"b".repeat(64)}`;
const hash = createHash("sha256").update(rawKey.slice(4)).digest("hex");
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const apiKeys: ApiKeyRepository = {
  async findByHash(value) { return value === hash ? { id: 2, companyId: 12, companyName: "Caller", userId: 4,
    name: "erp", keyHash: hash, permissions: ["erp.products:read", "erp.inventory:read", "erp.sales-orders:read", "erp.invoices:read"],
    isActive: true, expiresAt: null, allowedIps: [] } : null; },
  async markUsed() {}
};
const page = { items: [], hasMore: false, nextCursor: null };
const resources: ErpRepository = {
  async listProducts(companyId) { expect(companyId).toBe(12); return page; },
  async findProduct() { return null; },
  async listStockLevels() { return page; },
  async listSalesOrders() { return page; },
  async findSalesOrder() { return null; },
  async listInvoices() { return page; },
  async findInvoice() { return null; }
};
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe("ERP read routes", () => {
  it("registers only GET reads and rejects caller-supplied company_id", async () => {
    const app = await buildApp({ apiKeyRepository: apiKeys, erpRepository: resources, logger: false });
    apps.push(app);
    const headers = { authorization: `Bearer ${rawKey}` };
    expect((await app.inject({ method: "GET", url: "/api/v1/erp/products", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/erp/products", headers })).statusCode).toBe(503);
    expect((await app.inject({ method: "GET", url: "/api/v1/erp/products?company_id=77", headers })).statusCode).toBe(400);
  });

  it("uses resource-specific scopes", async () => {
    const narrowKeys: ApiKeyRepository = { ...apiKeys, async findByHash(value) {
      const key = await apiKeys.findByHash(value);
      return key === null ? null : { ...key, permissions: ["erp.products:read"] };
    } };
    const app = await buildApp({ apiKeyRepository: narrowKeys, erpRepository: resources, logger: false });
    apps.push(app);
    const headers = { authorization: `Bearer ${rawKey}` };
    expect((await app.inject({ method: "GET", url: "/api/v1/erp/products", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/erp/invoices", headers })).statusCode).toBe(403);
  });
});
