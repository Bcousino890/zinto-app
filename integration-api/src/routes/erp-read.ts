import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { createApiKeyAuthenticator, type ApiKeyRepository } from "../auth/api-key.js";
import { assertScopes } from "../auth/scopes.js";
import { parsePageQuery } from "../http/pagination.js";
import type { RateLimiter } from "../http/rate-limit.js";
import type { ErpReadRepository, ErpResource } from "../resources/erp-read.js";

function protect(keys: ApiKeyRepository, scopes: string[], rateLimiter?: RateLimiter) {
  const authenticate = createApiKeyAuthenticator(keys, rateLimiter);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    assertScopes(request.apiPrincipal!.scopes, scopes);
  };
}

function page(requestId: string, value: { items: unknown[]; nextCursor: string | null; hasMore: boolean }) {
  return { data: value.items, meta: { request_id: requestId, next_cursor: value.nextCursor, has_more: value.hasMore } };
}

const routes: Array<[string, ErpResource, string[]]> = [
  ["/api/v1/erp/products", "products", ["erp:read"]],
  ["/api/v1/erp/inventory/warehouses", "warehouses", ["erp:read", "inventory:read"]],
  ["/api/v1/erp/inventory/stock-levels", "stock_levels", ["erp:read", "inventory:read"]],
  ["/api/v1/erp/suppliers", "suppliers", ["erp:read"]],
  ["/api/v1/erp/sales-orders", "sales_orders", ["erp:read"]],
  ["/api/v1/erp/purchase-orders", "purchase_orders", ["erp:read"]],
  ["/api/v1/erp/invoices", "invoices", ["erp:read"]]
];

export function registerErpReadRoutes(app: FastifyInstance, keys: ApiKeyRepository, repo: ErpReadRepository, rateLimiter?: RateLimiter): void {
  for (const [path, resource, scopes] of routes) {
    app.get(path, { preHandler: protect(keys, scopes, rateLimiter) }, async (request) => page(
      request.id,
      await repo.list(request.apiPrincipal!.companyId, resource, parsePageQuery(request.query))
    ));
  }
}
