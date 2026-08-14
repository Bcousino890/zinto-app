import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { createApiKeyAuthenticator, type ApiKeyRepository } from "../auth/api-key.js";
import { assertScopes } from "../auth/scopes.js";
import { ApiError } from "../http/errors.js";
import { parsePageQuery } from "../http/pagination.js";
import type { ResourcePage } from "../resources/core.js";
import type { ErpRepository, InvoiceQuery, StatusQuery, StockQuery } from "../resources/erp.js";

const reference = z.string().regex(/^\d+$/).optional();
const pageFields = { cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).optional() };
const updatedFields = { ...pageFields, updated_since: z.string().datetime().optional() };
const productSchema = z.object({ ...updatedFields, status: z.enum(["active", "inactive", "draft", "archived"]).optional() }).strict();
const orderSchema = z.object({ ...updatedFields, status: z.enum(["draft", "quotation", "confirmed", "processing", "shipped", "delivered", "cancelled", "returned"]).optional() }).strict();
const invoiceSchema = z.object({
  ...updatedFields,
  status: z.enum(["draft", "sent", "partially_paid", "paid", "overdue", "cancelled", "void"]).optional(),
  type: z.enum(["sales_invoice", "purchase_invoice", "credit_note", "debit_note"]).optional()
}).strict();
const stockSchema = z.object({ ...pageFields, product_id: reference, warehouse_id: reference }).strict();

const responsePage = <T>(requestId: string, page: ResourcePage<T>) => ({
  data: page.items, meta: { request_id: requestId, next_cursor: page.nextCursor, has_more: page.hasMore }
});

function protectedHandler(apiKeys: ApiKeyRepository, scope: string) {
  const authenticate = createApiKeyAuthenticator(apiKeys);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    assertScopes(request.apiPrincipal!.scopes, [scope]);
  };
}

function parseStatus(value: unknown, schema: typeof productSchema | typeof orderSchema): StatusQuery {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw new ApiError(400, "validation_error", "The query parameters are invalid");
  return {
    ...parsePageQuery({ cursor: result.data.cursor, limit: result.data.limit }),
    updatedSince: result.data.updated_since === undefined ? null : new Date(result.data.updated_since).toISOString(),
    status: result.data.status ?? null
  };
}

function parseInvoices(value: unknown): InvoiceQuery {
  const result = invoiceSchema.safeParse(value ?? {});
  if (!result.success) throw new ApiError(400, "validation_error", "The query parameters are invalid");
  return {
    ...parsePageQuery({ cursor: result.data.cursor, limit: result.data.limit }),
    updatedSince: result.data.updated_since === undefined ? null : new Date(result.data.updated_since).toISOString(),
    status: result.data.status ?? null,
    type: result.data.type ?? null
  };
}

function parseStock(value: unknown): StockQuery {
  const result = stockSchema.safeParse(value ?? {});
  if (!result.success) throw new ApiError(400, "validation_error", "The query parameters are invalid");
  return {
    ...parsePageQuery({ cursor: result.data.cursor, limit: result.data.limit }),
    productId: result.data.product_id === undefined ? null : Number(result.data.product_id),
    warehouseId: result.data.warehouse_id === undefined ? null : Number(result.data.warehouse_id)
  };
}

function identifier(value: string, resource: string): number {
  if (!/^\d+$/.test(value)) throw new ApiError(400, "validation_error", `The ${resource} ID is invalid`);
  return Number(value);
}

export function registerErpRoutes(app: FastifyInstance, apiKeys: ApiKeyRepository, resources: ErpRepository): void {
  app.get("/api/v1/erp/products", { preHandler: protectedHandler(apiKeys, "erp.products:read") }, async (request) =>
    responsePage(request.id, await resources.listProducts(request.apiPrincipal!.companyId, parseStatus(request.query, productSchema))));
  app.get<{ Params: { id: string } }>("/api/v1/erp/products/:id", { preHandler: protectedHandler(apiKeys, "erp.products:read") }, async (request) => {
    const data = await resources.findProduct(request.apiPrincipal!.companyId, identifier(request.params.id, "product"));
    if (data === null) throw new ApiError(404, "product_not_found", "The product was not found");
    return { data, meta: { request_id: request.id } };
  });
  app.get("/api/v1/erp/stock-levels", { preHandler: protectedHandler(apiKeys, "erp.inventory:read") }, async (request) =>
    responsePage(request.id, await resources.listStockLevels(request.apiPrincipal!.companyId, parseStock(request.query))));
  app.get("/api/v1/erp/sales-orders", { preHandler: protectedHandler(apiKeys, "erp.sales-orders:read") }, async (request) =>
    responsePage(request.id, await resources.listSalesOrders(request.apiPrincipal!.companyId, parseStatus(request.query, orderSchema))));
  app.get<{ Params: { id: string } }>("/api/v1/erp/sales-orders/:id", { preHandler: protectedHandler(apiKeys, "erp.sales-orders:read") }, async (request) => {
    const data = await resources.findSalesOrder(request.apiPrincipal!.companyId, identifier(request.params.id, "sales order"));
    if (data === null) throw new ApiError(404, "sales_order_not_found", "The sales order was not found");
    return { data, meta: { request_id: request.id } };
  });
  app.get("/api/v1/erp/invoices", { preHandler: protectedHandler(apiKeys, "erp.invoices:read") }, async (request) =>
    responsePage(request.id, await resources.listInvoices(request.apiPrincipal!.companyId, parseInvoices(request.query))));
  app.get<{ Params: { id: string } }>("/api/v1/erp/invoices/:id", { preHandler: protectedHandler(apiKeys, "erp.invoices:read") }, async (request) => {
    const data = await resources.findInvoice(request.apiPrincipal!.companyId, identifier(request.params.id, "invoice"));
    if (data === null) throw new ApiError(404, "invoice_not_found", "The invoice was not found");
    return { data, meta: { request_id: request.id } };
  });
}
