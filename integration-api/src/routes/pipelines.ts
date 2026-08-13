import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { createApiKeyAuthenticator, type ApiKeyRepository } from "../auth/api-key.js";
import { assertScopes } from "../auth/scopes.js";
import { ApiError } from "../http/errors.js";
import { parsePageQuery } from "../http/pagination.js";
import type { ResourcePage } from "../resources/core.js";
import type {
  DealQuery,
  IncrementalQuery,
  PipelineRepository,
  TaskQuery
} from "../resources/pipelines.js";

const FILTERS = ["updated_since", "pipeline_id", "contact_id"] as const;
type Filter = (typeof FILTERS)[number];

const reference = z.string().regex(/^\d+$/).optional();
const filterSchema = z.object({
  updated_since: z.string().datetime().optional(),
  pipeline_id: reference,
  contact_id: reference
}).strict();

function responsePage<T>(requestId: string, page: ResourcePage<T>) {
  return {
    data: page.items,
    meta: {
      request_id: requestId,
      next_cursor: page.nextCursor,
      has_more: page.hasMore
    }
  };
}

function protectedHandler(apiKeys: ApiKeyRepository, scopes: string[]) {
  const authenticate = createApiKeyAuthenticator(apiKeys);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    assertScopes(request.apiPrincipal!.scopes, scopes);
  };
}

function identifier(value: string, resource: string): number {
  if (!/^\d+$/.test(value)) {
    throw new ApiError(400, "validation_error", `The ${resource} ID is invalid`);
  }
  return Number(value);
}

/**
 * Los filtros propios se separan antes de delegar en `parsePageQuery`, que es
 * estricto y sigue rechazando cualquier parametro no soportado por la ruta.
 */
function parseListQuery(value: unknown, allowed: readonly Filter[]): DealQuery & TaskQuery {
  const source = (value ?? {}) as Record<string, unknown>;
  const filters: Record<string, unknown> = {};
  const pagination: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    if ((allowed as readonly string[]).includes(key)) filters[key] = entry;
    else pagination[key] = entry;
  }

  const parsed = filterSchema.safeParse(filters);
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", "The query parameters are invalid");
  }
  const page = parsePageQuery(pagination);
  return {
    ...page,
    updatedSince: parsed.data.updated_since === undefined
      ? null
      : new Date(parsed.data.updated_since).toISOString(),
    pipelineId: parsed.data.pipeline_id === undefined ? null : Number(parsed.data.pipeline_id),
    contactId: parsed.data.contact_id === undefined ? null : Number(parsed.data.contact_id)
  };
}

const incremental = (query: DealQuery & TaskQuery): IncrementalQuery => ({
  cursor: query.cursor,
  limit: query.limit,
  updatedSince: query.updatedSince
});

export function registerPipelineRoutes(
  app: FastifyInstance,
  apiKeys: ApiKeyRepository,
  resources: PipelineRepository
): void {
  app.get(
    "/api/v1/pipelines",
    { preHandler: protectedHandler(apiKeys, ["pipelines:read"]) },
    async (request) => responsePage(
      request.id,
      await resources.listPipelines(
        request.apiPrincipal!.companyId,
        incremental(parseListQuery(request.query, ["updated_since"]))
      )
    )
  );

  app.get<{ Params: { id: string } }>(
    "/api/v1/pipelines/:id/stages",
    { preHandler: protectedHandler(apiKeys, ["pipelines:read"]) },
    async (request) => {
      const page = await resources.listStages(
        request.apiPrincipal!.companyId,
        identifier(request.params.id, "pipeline"),
        incremental(parseListQuery(request.query, ["updated_since"]))
      );
      if (page === null) {
        throw new ApiError(404, "pipeline_not_found", "The pipeline was not found");
      }
      return responsePage(request.id, page);
    }
  );

  app.get(
    "/api/v1/deals",
    { preHandler: protectedHandler(apiKeys, ["deals:read"]) },
    async (request) => responsePage(
      request.id,
      await resources.listDeals(
        request.apiPrincipal!.companyId,
        parseListQuery(request.query, ["updated_since", "pipeline_id", "contact_id"])
      )
    )
  );

  app.get<{ Params: { id: string } }>(
    "/api/v1/deals/:id",
    { preHandler: protectedHandler(apiKeys, ["deals:read"]) },
    async (request) => {
      const data = await resources.findDeal(
        request.apiPrincipal!.companyId,
        identifier(request.params.id, "deal")
      );
      if (data === null) {
        throw new ApiError(404, "deal_not_found", "The deal was not found");
      }
      return { data, meta: { request_id: request.id } };
    }
  );

  app.get(
    "/api/v1/tasks",
    { preHandler: protectedHandler(apiKeys, ["tasks:read"]) },
    async (request) => responsePage(
      request.id,
      await resources.listTasks(
        request.apiPrincipal!.companyId,
        parseListQuery(request.query, ["updated_since", "contact_id"])
      )
    )
  );
}
