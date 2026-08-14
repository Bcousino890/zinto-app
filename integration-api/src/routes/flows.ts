import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { createApiKeyAuthenticator, type ApiKeyRepository } from "../auth/api-key.js";
import { assertScopes } from "../auth/scopes.js";
import { ApiError } from "../http/errors.js";
import { parsePageQuery } from "../http/pagination.js";
import type { IncrementalQuery, ResourcePage } from "../resources/core.js";
import type { FlowExecutionQuery, FlowRepository } from "../resources/flows.js";

const reference = z.string().regex(/^\d+$/).optional();
const pageFields = {
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  updated_since: z.string().datetime().optional()
};
const listSchema = z.object(pageFields).strict();
const executionSchema = z.object({
  ...pageFields,
  flow_id: reference,
  status: z.enum(["running", "waiting", "completed", "failed", "abandoned", "timeout"]).optional()
}).strict();

const responsePage = <T>(requestId: string, page: ResourcePage<T>) => ({
  data: page.items,
  meta: { request_id: requestId, next_cursor: page.nextCursor, has_more: page.hasMore }
});

function protectedHandler(apiKeys: ApiKeyRepository) {
  const authenticate = createApiKeyAuthenticator(apiKeys);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    assertScopes(request.apiPrincipal!.scopes, ["flows:read"]);
  };
}

function incremental(value: unknown): IncrementalQuery {
  const result = listSchema.safeParse(value ?? {});
  if (!result.success) throw new ApiError(400, "validation_error", "The query parameters are invalid");
  const page = parsePageQuery({ cursor: result.data.cursor, limit: result.data.limit });
  return { ...page, updatedSince: result.data.updated_since === undefined ? null : new Date(result.data.updated_since).toISOString() };
}

function executions(value: unknown): FlowExecutionQuery {
  const result = executionSchema.safeParse(value ?? {});
  if (!result.success) throw new ApiError(400, "validation_error", "The query parameters are invalid");
  const page = parsePageQuery({ cursor: result.data.cursor, limit: result.data.limit });
  return {
    ...page,
    updatedSince: result.data.updated_since === undefined ? null : new Date(result.data.updated_since).toISOString(),
    flowId: result.data.flow_id === undefined ? null : Number(result.data.flow_id),
    status: result.data.status ?? null
  };
}

function identifier(value: string): number {
  if (!/^\d+$/.test(value)) throw new ApiError(400, "validation_error", "The flow ID is invalid");
  return Number(value);
}

export function registerFlowRoutes(app: FastifyInstance, apiKeys: ApiKeyRepository, resources: FlowRepository): void {
  const preHandler = protectedHandler(apiKeys);
  app.get("/api/v1/flows", { preHandler }, async (request) => responsePage(
    request.id,
    await resources.listFlows(request.apiPrincipal!.companyId, incremental(request.query))
  ));
  app.get<{ Params: { id: string } }>("/api/v1/flows/:id", { preHandler }, async (request) => {
    const data = await resources.findFlow(request.apiPrincipal!.companyId, identifier(request.params.id));
    if (data === null) throw new ApiError(404, "flow_not_found", "The flow was not found");
    return { data, meta: { request_id: request.id } };
  });
  app.get<{ Params: { id: string } }>("/api/v1/flows/:id/assignments", { preHandler }, async (request) => {
    const page = await resources.listAssignments(
      request.apiPrincipal!.companyId,
      identifier(request.params.id),
      incremental(request.query)
    );
    if (page === null) throw new ApiError(404, "flow_not_found", "The flow was not found");
    return responsePage(request.id, page);
  });
  app.get("/api/v1/flow-executions", { preHandler }, async (request) => responsePage(
    request.id,
    await resources.listExecutions(request.apiPrincipal!.companyId, executions(request.query))
  ));
}
