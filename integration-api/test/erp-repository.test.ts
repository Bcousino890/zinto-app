import type pg from "pg";
import { describe, expect, it } from "vitest";

import { PostgresErpRepository } from "../src/resources/erp.js";

interface Call { text: string; params: unknown[] }
class FakePool {
  calls: Call[] = [];
  constructor(private readonly responses: Array<{ rows: unknown[] }> = []) {}
  async query(text: string, params: unknown[]) { this.calls.push({ text, params }); return this.responses[this.calls.length - 1] ?? { rows: [] }; }
}
const flat = (value: string) => value.replace(/\s+/g, " ").trim();
const page = { cursor: null, limit: 50, updatedSince: null };
function setup(responses: Array<{ rows: unknown[] }> = []) {
  const pool = new FakePool(responses);
  return { pool, repository: new PostgresErpRepository(pool as unknown as pg.Pool) };
}

describe("ERP read repository", () => {
  it("serializes product amounts as exact decimal strings and filters by company", async () => {
    const { pool, repository } = setup([{ rows: [{ id: 3, category_id: null, sku: "SKU-1", name: "Servicio",
      description: null, type: "service", unit_price: "19.90", cost_price: "10.00", currency: "EUR",
      unit_of_measure: "unit", barcode: null, status: "active", tags: null, is_taxable: true, weight: null,
      created_at: new Date("2026-08-10T10:00:00Z"), updated_at: new Date("2026-08-11T10:00:00Z") }] }]);
    const result = await repository.listProducts(12, { ...page, status: null });
    expect(flat(pool.calls[0]!.text)).toContain("FROM products WHERE company_id = $1");
    expect(pool.calls[0]!.params).toEqual([12, null, null, null, null, 51]);
    expect(result.items[0]!.unit_price).toBe("19.90");
    expect(result.items[0]!.cost_price).toBe("10.00");
  });

  it("scopes stock references to the same company", async () => {
    const { pool, repository } = setup();
    await repository.listStockLevels(12, { cursor: null, limit: 50, productId: 3, warehouseId: 4 });
    const sql = flat(pool.calls[0]!.text);
    expect(sql).toContain("JOIN products ON products.id = stock_levels.product_id AND products.company_id = stock_levels.company_id");
    expect(sql).toContain("JOIN warehouses ON warehouses.id = stock_levels.warehouse_id AND warehouses.company_id = stock_levels.company_id");
    expect(sql).toContain("stock_levels.company_id = $1");
    expect(pool.calls[0]!.params).toEqual([12, 3, 4, null, null, 51]);
  });

  it("strictly scopes sales orders and invoices", async () => {
    const { pool, repository } = setup();
    await repository.listSalesOrders(12, { ...page, status: "confirmed" });
    await repository.listInvoices(12, { ...page, status: "sent", type: "sales_invoice" });
    expect(flat(pool.calls[0]!.text)).toContain("FROM sales_orders WHERE company_id = $1");
    expect(flat(pool.calls[1]!.text)).toContain("FROM invoices WHERE company_id = $1");
    expect(pool.calls[0]!.params[0]).toBe(12);
    expect(pool.calls[1]!.params[0]).toBe(12);
  });

  it("returns null for cross-tenant product, order, and invoice details", async () => {
    const { pool, repository } = setup([{ rows: [] }, { rows: [] }, { rows: [] }]);
    expect(await repository.findProduct(12, 99)).toBeNull();
    expect(await repository.findSalesOrder(12, 99)).toBeNull();
    expect(await repository.findInvoice(12, 99)).toBeNull();
    for (const call of pool.calls) {
      expect(call.params).toEqual([12, 99]);
      expect(flat(call.text)).toContain("company_id = $1 AND id = $2");
    }
  });
});
