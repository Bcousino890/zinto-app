import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createApiKeyAuthenticator, type ApiKeyRepository } from "../auth/api-key.js";
import { assertScopes } from "../auth/scopes.js";
import { ApiError } from "../http/errors.js";
import { parsePageQuery } from "../http/pagination.js";
import type { FlowReadRepository } from "../resources/flow-reads.js";

function id(value: string, name: string): number { if (!/^\d+$/.test(value)) throw new ApiError(400, "validation_error", `The ${name} ID is invalid`); return Number(value); }
function preHandler(keys: ApiKeyRepository) { const auth = createApiKeyAuthenticator(keys); return async (request: FastifyRequest, reply: FastifyReply) => { await auth(request, reply); assertScopes(request.apiPrincipal!.scopes, ["flows:read"]); }; }
function page(requestId: string, value: { items: unknown[]; nextCursor: string | null; hasMore: boolean }) { return { data: value.items, meta: { request_id: requestId, next_cursor: value.nextCursor, has_more: value.hasMore } }; }
export function registerFlowReadRoutes(app: FastifyInstance, keys: ApiKeyRepository, repo: FlowReadRepository): void {
  const handler = preHandler(keys);
  app.get("/api/v1/flows", { preHandler: handler }, async (request) => page(request.id, await repo.listFlows(request.apiPrincipal!.companyId, parsePageQuery(request.query))));
  app.get<{ Params: { id: string } }>("/api/v1/flows/:id", { preHandler: handler }, async (request) => { const value = await repo.findFlow(request.apiPrincipal!.companyId, id(request.params.id, "flow")); if (value === null) throw new ApiError(404, "flow_not_found", "The flow was not found"); return { data: value, meta: { request_id: request.id } }; });
  app.get<{ Params: { id: string } }>("/api/v1/flows/:id/sessions", { preHandler: handler }, async (request) => { const value = await repo.listSessions(request.apiPrincipal!.companyId, id(request.params.id, "flow"), parsePageQuery(request.query)); if (value === null) throw new ApiError(404, "flow_not_found", "The flow was not found"); return page(request.id, value); });
  app.get<{ Params: { id: string } }>("/api/v1/flows/:id/executions", { preHandler: handler }, async (request) => { const value = await repo.listExecutions(request.apiPrincipal!.companyId, id(request.params.id, "flow"), parsePageQuery(request.query)); if (value === null) throw new ApiError(404, "flow_not_found", "The flow was not found"); return page(request.id, value); });
  app.get("/api/v1/flow-templates", { preHandler: handler }, async (request) => page(request.id, await repo.listTemplates(parsePageQuery(request.query))));
}
