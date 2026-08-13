import type pg from "pg";

import { cursorParameters, iso, paged, type PageQuery, type ResourcePage, type Timestamp } from "./core.js";

export type ErpResource = "products" | "warehouses" | "stock_levels" | "suppliers" | "sales_orders" | "purchase_orders" | "invoices";

export interface ErpReadRepository {
  list(companyId: number, resource: ErpResource, query: PageQuery): Promise<ResourcePage<Record<string, unknown>>>;
}

type Definition = { table: string; order: "created_at" | "updated_at"; columns: string };

// Columns are copied only from verified backup migrations 150-156 and 177.
const definitions: Record<ErpResource, Definition> = {
  products: {
    table: "products", order: "created_at",
    columns: "id, category_id, sku, name, description, type, unit_price, cost_price, currency, unit_of_measure, barcode, status, images, custom_fields, tags, is_taxable, weight, created_at, updated_at"
  },
  warehouses: {
    table: "warehouses", order: "created_at",
    columns: "id, name, address, is_default, is_active, notes, created_at, updated_at"
  },
  stock_levels: {
    table: "stock_levels", order: "updated_at",
    columns: "id, product_id, variant_id, warehouse_id, quantity, reserved_qty, reorder_point, reorder_qty, updated_at"
  },
  suppliers: {
    table: "suppliers", order: "created_at",
    columns: "id, name, contact_name, email, phone, address, tax_id, payment_terms, currency, notes, status, rating, created_at, updated_at"
  },
  sales_orders: {
    table: "sales_orders", order: "created_at",
    columns: "id, order_number, contact_id, deal_id, status, subtotal, tax_amount, discount_amount, total_amount, currency, notes, assigned_to_user_id, valid_until, shipping_address, billing_address, created_at, updated_at, source, flow_id, channel_connection_id"
  },
  purchase_orders: {
    table: "purchase_orders", order: "created_at",
    columns: "id, order_number, supplier_id, status, subtotal, tax_amount, total_amount, currency, expected_delivery_date, notes, created_at, updated_at"
  },
  invoices: {
    table: "invoices", order: "created_at",
    columns: "id, invoice_number, contact_id, supplier_id, sales_order_id, purchase_order_id, type, status, issue_date, due_date, subtotal, tax_amount, discount_amount, total_amount, amount_paid, amount_due, currency, notes, terms_and_conditions, pdf_url, created_at, updated_at"
  }
};

const referenceColumns = new Set(["category_id", "product_id", "variant_id", "warehouse_id", "contact_id", "deal_id", "supplier_id", "sales_order_id", "purchase_order_id", "assigned_to_user_id", "flow_id", "channel_connection_id"]);
const dateColumns = new Set(["created_at", "updated_at", "valid_until", "expected_delivery_date", "issue_date", "due_date"]);

function normalize(row: Record<string, unknown>): Record<string, unknown> & { id: string; created_at: string } {
  const output: Record<string, unknown> = { ...row, id: String(row.id) };
  if (output.created_at === undefined && output.updated_at !== undefined) output.created_at = output.updated_at;
  for (const key of referenceColumns) {
    if (output[key] !== null && output[key] !== undefined) output[key] = String(output[key]);
  }
  for (const key of dateColumns) {
    if (output[key] !== null && output[key] !== undefined) output[key] = iso(output[key] as Timestamp);
  }
  return output as Record<string, unknown> & { id: string; created_at: string };
}

export class PostgresErpReadRepository implements ErpReadRepository {
  constructor(private readonly pool: pg.Pool) {}

  async list(companyId: number, resource: ErpResource, query: PageQuery): Promise<ResourcePage<Record<string, unknown>>> {
    const definition = definitions[resource];
    const [cursorDate, cursorId] = cursorParameters(query);
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT ${definition.columns} FROM ${definition.table}
       WHERE company_id = $1
         AND ($2::timestamp IS NULL OR (${definition.order}, id) < ($2::timestamp, $3::integer))
       ORDER BY ${definition.order} DESC NULLS LAST, id DESC
       LIMIT $4`,
      [companyId, cursorDate, cursorId, query.limit + 1]
    );
    return paged(result.rows.map(normalize), query.limit);
  }
}
