import type pg from "pg";

import { cursorParameters, iso, paged, type IncrementalQuery, type PageQuery, type ResourcePage, type Timestamp } from "./core.js";
import { encodeCursor } from "../http/pagination.js";

export interface StatusQuery extends IncrementalQuery { status: string | null }
export interface InvoiceQuery extends StatusQuery { type: string | null }
export interface StockQuery extends PageQuery { productId: number | null; warehouseId: number | null }

export interface ProductResource {
  id: string; category_id: string | null; sku: string | null; name: string; description: string | null;
  type: string; unit_price: string | null; cost_price: string | null; currency: string | null;
  unit_of_measure: string | null; barcode: string | null; status: string; tags: string[];
  taxable: boolean; weight: string | null; created_at: string; updated_at: string;
}
export interface StockLevelResource {
  id: string; product_id: string; product_name: string; product_sku: string | null;
  variant_id: string | null; variant_name: string | null; warehouse_id: string; warehouse_name: string;
  quantity: string; reserved_quantity: string; reorder_point: string | null;
  reorder_quantity: string | null; updated_at: string;
}
export interface SalesOrderResource {
  id: string; order_number: string; contact_id: string | null; deal_id: string | null; status: string;
  subtotal: string; tax_amount: string; discount_amount: string; total_amount: string;
  currency: string | null; assigned_to_user_id: string | null; valid_until: string | null;
  source: string; flow_id: string | null; channel_id: string | null; created_at: string; updated_at: string;
}
export interface InvoiceResource {
  id: string; invoice_number: string; contact_id: string | null; supplier_id: string | null;
  sales_order_id: string | null; purchase_order_id: string | null; type: string; status: string;
  issue_date: string | null; due_date: string | null; subtotal: string; tax_amount: string;
  discount_amount: string; total_amount: string; amount_paid: string; amount_due: string;
  currency: string | null; created_at: string; updated_at: string;
}

export interface ErpRepository {
  listProducts(companyId: number, query: StatusQuery): Promise<ResourcePage<ProductResource>>;
  findProduct(companyId: number, productId: number): Promise<ProductResource | null>;
  listStockLevels(companyId: number, query: StockQuery): Promise<ResourcePage<StockLevelResource>>;
  listSalesOrders(companyId: number, query: StatusQuery): Promise<ResourcePage<SalesOrderResource>>;
  findSalesOrder(companyId: number, orderId: number): Promise<SalesOrderResource | null>;
  listInvoices(companyId: number, query: InvoiceQuery): Promise<ResourcePage<InvoiceResource>>;
  findInvoice(companyId: number, invoiceId: number): Promise<InvoiceResource | null>;
}

interface ProductRow {
  id: number; category_id: number | null; sku: string | null; name: string; description: string | null;
  type: string; unit_price: string | number | null; cost_price: string | number | null; currency: string | null;
  unit_of_measure: string | null; barcode: string | null; status: string; tags: string[] | null;
  is_taxable: boolean | null; weight: string | number | null; created_at: Timestamp; updated_at: Timestamp;
}
interface StockRow {
  id: number; product_id: number; product_name: string; product_sku: string | null; variant_id: number | null;
  variant_name: string | null; warehouse_id: number; warehouse_name: string; quantity: string | number;
  reserved_qty: string | number; reorder_point: string | number | null; reorder_qty: string | number | null; updated_at: Timestamp;
}
interface OrderRow {
  id: number; order_number: string; contact_id: number | null; deal_id: number | null; status: string;
  subtotal: string | number; tax_amount: string | number; discount_amount: string | number; total_amount: string | number;
  currency: string | null; assigned_to_user_id: number | null; valid_until: Timestamp; source: string;
  flow_id: number | null; channel_connection_id: number | null; created_at: Timestamp; updated_at: Timestamp;
}
interface InvoiceRow {
  id: number; invoice_number: string; contact_id: number | null; supplier_id: number | null;
  sales_order_id: number | null; purchase_order_id: number | null; type: string; status: string;
  issue_date: Timestamp; due_date: Timestamp; subtotal: string | number; tax_amount: string | number;
  discount_amount: string | number; total_amount: string | number; amount_paid: string | number;
  amount_due: string | number; currency: string | null; created_at: Timestamp; updated_at: Timestamp;
}

const ref = (value: number | null) => value === null ? null : String(value);
const decimal = (value: string | number | null) => value === null ? null : String(value);
const product = (row: ProductRow): ProductResource => ({
  id: String(row.id), category_id: ref(row.category_id), sku: row.sku, name: row.name,
  description: row.description, type: row.type, unit_price: decimal(row.unit_price),
  cost_price: decimal(row.cost_price), currency: row.currency, unit_of_measure: row.unit_of_measure,
  barcode: row.barcode, status: row.status, tags: row.tags ?? [], taxable: row.is_taxable ?? true,
  weight: decimal(row.weight), created_at: iso(row.created_at)!, updated_at: iso(row.updated_at)!
});
const order = (row: OrderRow): SalesOrderResource => ({
  id: String(row.id), order_number: row.order_number, contact_id: ref(row.contact_id), deal_id: ref(row.deal_id),
  status: row.status, subtotal: String(row.subtotal), tax_amount: String(row.tax_amount),
  discount_amount: String(row.discount_amount), total_amount: String(row.total_amount), currency: row.currency,
  assigned_to_user_id: ref(row.assigned_to_user_id), valid_until: iso(row.valid_until), source: row.source,
  flow_id: ref(row.flow_id), channel_id: ref(row.channel_connection_id), created_at: iso(row.created_at)!, updated_at: iso(row.updated_at)!
});
const invoice = (row: InvoiceRow): InvoiceResource => ({
  id: String(row.id), invoice_number: row.invoice_number, contact_id: ref(row.contact_id), supplier_id: ref(row.supplier_id),
  sales_order_id: ref(row.sales_order_id), purchase_order_id: ref(row.purchase_order_id), type: row.type, status: row.status,
  issue_date: iso(row.issue_date), due_date: iso(row.due_date), subtotal: String(row.subtotal), tax_amount: String(row.tax_amount),
  discount_amount: String(row.discount_amount), total_amount: String(row.total_amount), amount_paid: String(row.amount_paid),
  amount_due: String(row.amount_due), currency: row.currency, created_at: iso(row.created_at)!, updated_at: iso(row.updated_at)!
});

const PRODUCT_COLUMNS = `id, category_id, sku, name, description, type, unit_price, cost_price,
  currency, unit_of_measure, barcode, status, tags, is_taxable, weight, created_at, updated_at`;
const ORDER_COLUMNS = `id, order_number, contact_id, deal_id, status, subtotal, tax_amount,
  discount_amount, total_amount, currency, assigned_to_user_id, valid_until, source, flow_id,
  channel_connection_id, created_at, updated_at`;
const INVOICE_COLUMNS = `id, invoice_number, contact_id, supplier_id, sales_order_id, purchase_order_id,
  type, status, issue_date, due_date, subtotal, tax_amount, discount_amount, total_amount,
  amount_paid, amount_due, currency, created_at, updated_at`;

export class PostgresErpRepository implements ErpRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listProducts(companyId: number, query: StatusQuery): Promise<ResourcePage<ProductResource>> {
    const [cursorDate, cursorId] = cursorParameters(query);
    const result = await this.pool.query<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products WHERE company_id = $1
        AND ($2::text IS NULL OR status = $2::text)
        AND ($3::timestamp IS NULL OR updated_at >= $3::timestamp)
        AND ($4::timestamp IS NULL OR (created_at, id) < ($4::timestamp, $5::integer))
        ORDER BY created_at DESC, id DESC LIMIT $6`,
      [companyId, query.status, query.updatedSince, cursorDate, cursorId, query.limit + 1]
    );
    return paged(result.rows.map(product), query.limit);
  }

  async findProduct(companyId: number, productId: number): Promise<ProductResource | null> {
    const result = await this.pool.query<ProductRow>(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE company_id = $1 AND id = $2`, [companyId, productId]);
    return result.rows[0] === undefined ? null : product(result.rows[0]);
  }

  async listStockLevels(companyId: number, query: StockQuery): Promise<ResourcePage<StockLevelResource>> {
    const [cursorDate, cursorId] = cursorParameters(query);
    const result = await this.pool.query<StockRow>(
      `SELECT stock_levels.id, stock_levels.product_id, products.name AS product_name,
              products.sku AS product_sku, stock_levels.variant_id, product_variants.name AS variant_name,
              stock_levels.warehouse_id, warehouses.name AS warehouse_name, stock_levels.quantity,
              stock_levels.reserved_qty, stock_levels.reorder_point, stock_levels.reorder_qty, stock_levels.updated_at
         FROM stock_levels
         JOIN products ON products.id = stock_levels.product_id AND products.company_id = stock_levels.company_id
         JOIN warehouses ON warehouses.id = stock_levels.warehouse_id AND warehouses.company_id = stock_levels.company_id
         LEFT JOIN product_variants ON product_variants.id = stock_levels.variant_id
              AND product_variants.product_id = stock_levels.product_id
              AND product_variants.company_id = stock_levels.company_id
        WHERE stock_levels.company_id = $1
          AND ($2::integer IS NULL OR stock_levels.product_id = $2::integer)
          AND ($3::integer IS NULL OR stock_levels.warehouse_id = $3::integer)
          AND ($4::timestamp IS NULL OR (stock_levels.updated_at, stock_levels.id) < ($4::timestamp, $5::integer))
        ORDER BY stock_levels.updated_at DESC, stock_levels.id DESC LIMIT $6`,
      [companyId, query.productId, query.warehouseId, cursorDate, cursorId, query.limit + 1]
    );
    const hasMore = result.rows.length > query.limit;
    const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
    const items = rows.map((row) => ({
      id: String(row.id), product_id: String(row.product_id), product_name: row.product_name,
      product_sku: row.product_sku, variant_id: ref(row.variant_id), variant_name: row.variant_name,
      warehouse_id: String(row.warehouse_id), warehouse_name: row.warehouse_name,
      quantity: String(row.quantity), reserved_quantity: String(row.reserved_qty),
      reorder_point: decimal(row.reorder_point), reorder_quantity: decimal(row.reorder_qty), updated_at: iso(row.updated_at)!
    }));
    const last = items.at(-1);
    return { items, hasMore, nextCursor: hasMore && last !== undefined
      ? encodeCursor({ id: last.id, createdAt: last.updated_at }) : null };
  }

  async listSalesOrders(companyId: number, query: StatusQuery): Promise<ResourcePage<SalesOrderResource>> {
    const [cursorDate, cursorId] = cursorParameters(query);
    const result = await this.pool.query<OrderRow>(
      `SELECT ${ORDER_COLUMNS} FROM sales_orders WHERE company_id = $1
        AND ($2::text IS NULL OR status = $2::text)
        AND ($3::timestamp IS NULL OR updated_at >= $3::timestamp)
        AND ($4::timestamp IS NULL OR (created_at, id) < ($4::timestamp, $5::integer))
        ORDER BY created_at DESC, id DESC LIMIT $6`,
      [companyId, query.status, query.updatedSince, cursorDate, cursorId, query.limit + 1]
    );
    return paged(result.rows.map(order), query.limit);
  }

  async findSalesOrder(companyId: number, orderId: number): Promise<SalesOrderResource | null> {
    const result = await this.pool.query<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM sales_orders WHERE company_id = $1 AND id = $2`, [companyId, orderId]);
    return result.rows[0] === undefined ? null : order(result.rows[0]);
  }

  async listInvoices(companyId: number, query: InvoiceQuery): Promise<ResourcePage<InvoiceResource>> {
    const [cursorDate, cursorId] = cursorParameters(query);
    const result = await this.pool.query<InvoiceRow>(
      `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE company_id = $1
        AND ($2::text IS NULL OR status = $2::text) AND ($3::text IS NULL OR type = $3::text)
        AND ($4::timestamp IS NULL OR updated_at >= $4::timestamp)
        AND ($5::timestamp IS NULL OR (created_at, id) < ($5::timestamp, $6::integer))
        ORDER BY created_at DESC, id DESC LIMIT $7`,
      [companyId, query.status, query.type, query.updatedSince, cursorDate, cursorId, query.limit + 1]
    );
    return paged(result.rows.map(invoice), query.limit);
  }

  async findInvoice(companyId: number, invoiceId: number): Promise<InvoiceResource | null> {
    const result = await this.pool.query<InvoiceRow>(`SELECT ${INVOICE_COLUMNS} FROM invoices WHERE company_id = $1 AND id = $2`, [companyId, invoiceId]);
    return result.rows[0] === undefined ? null : invoice(result.rows[0]);
  }
}
