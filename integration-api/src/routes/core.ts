import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { createApiKeyAuthenticator, type ApiKeyRepository } from "../auth/api-key.js";
import { assertScopes } from "../auth/scopes.js";
import { ApiError } from "../http/errors.js";
import { parsePageQuery } from "../http/pagination.js";
import type { RateLimiter } from "../http/rate-limit.js";
import type { CoreRepository, IncrementalQuery, ResourcePage } from "../resources/core.js";

const FILTERS = ["updated_since"] as const;
type Filter = (typeof FILTERS)[number];

const filterSchema = z.object({
  updated_since: z.string().datetime().optional()
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

function protectedHandler(apiKeys: ApiKeyRepository, scopes: string[], rateLimiter?: RateLimiter) {
  const authenticate = createApiKeyAuthenticator(apiKeys, rateLimiter);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    assertScopes(request.apiPrincipal!.scopes, scopes);
  };
}

/**
 * Mismo patron que `parseListQuery` en routes/pipelines.ts: el unico filtro
 * propio de este bloque (`updated_since`) se separa antes de delegar en
 * `parsePageQuery`, que sigue siendo estricto y rechaza cualquier otro
 * parametro no soportado.
 */
function parseIncrementalQuery(value: unknown): IncrementalQuery {
  const source = (value ?? {}) as Record<string, unknown>;
  const filters: Record<string, unknown> = {};
  const pagination: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    if ((FILTERS as readonly string[]).includes(key)) filters[key as Filter] = entry;
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
      : new Date(parsed.data.updated_since).toISOString()
  };
}

export function registerCoreRoutes(
  app: FastifyInstance,
  apiKeys: ApiKeyRepository,
  resources: CoreRepository,
  rateLimiter?: RateLimiter
): void {
  app.get(
    "/api/v1/channels",
    { preHandler: protectedHandler(apiKeys, ["channels:read"], rateLimiter) },
    async (request) => ({
      data: await resources.listChannels(request.apiPrincipal!.companyId),
      meta: { request_id: request.id }
    })
  );

  app.get(
    "/api/v1/contacts",
    { preHandler: protectedHandler(apiKeys, ["contacts:read"], rateLimiter) },
    async (request) => responsePage(
      request.id,
      await resources.listContacts(request.apiPrincipal!.companyId, parseIncrementalQuery(request.query))
    )
  );

  app.get(
    "/api/v1/conversations",
    { preHandler: protectedHandler(apiKeys, ["conversations:read"], rateLimiter) },
    async (request) => responsePage(
      request.id,
      await resources.listConversations(request.apiPrincipal!.companyId, parseIncrementalQuery(request.query))
    )
  );

  app.get<{ Params: { id: string } }>(
    "/api/v1/conversations/:id/messages",
    { preHandler: protectedHandler(apiKeys, ["conversations:read", "messages:read"], rateLimiter) },
    async (request) => {
      if (!/^\d+$/.test(request.params.id)) {
        throw new ApiError(400, "validation_error", "The conversation ID is invalid");
      }
      const page = await resources.listMessages(
        request.apiPrincipal!.companyId,
        Number(request.params.id),
        parseIncrementalQuery(request.query)
      );
      if (page === null) {
        throw new ApiError(404, "conversation_not_found", "The conversation was not found");
      }
      return responsePage(request.id, page);
    }
  );
}
