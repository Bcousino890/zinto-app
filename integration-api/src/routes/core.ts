import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { createApiKeyAuthenticator, type ApiKeyRepository } from "../auth/api-key.js";
import { assertScopes } from "../auth/scopes.js";
import { ApiError } from "../http/errors.js";
import { parsePageQuery } from "../http/pagination.js";
import type { CoreRepository, ResourcePage } from "../resources/core.js";

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

export function registerCoreRoutes(
  app: FastifyInstance,
  apiKeys: ApiKeyRepository,
  resources: CoreRepository
): void {
  app.get(
    "/api/v1/channels",
    { preHandler: protectedHandler(apiKeys, ["channels:read"]) },
    async (request) => ({
      data: await resources.listChannels(request.apiPrincipal!.companyId),
      meta: { request_id: request.id }
    })
  );

  app.get(
    "/api/v1/contacts",
    { preHandler: protectedHandler(apiKeys, ["contacts:read"]) },
    async (request) => responsePage(
      request.id,
      await resources.listContacts(request.apiPrincipal!.companyId, parsePageQuery(request.query))
    )
  );

  app.get(
    "/api/v1/conversations",
    { preHandler: protectedHandler(apiKeys, ["conversations:read"]) },
    async (request) => responsePage(
      request.id,
      await resources.listConversations(request.apiPrincipal!.companyId, parsePageQuery(request.query))
    )
  );

  app.get<{ Params: { id: string } }>(
    "/api/v1/conversations/:id/messages",
    { preHandler: protectedHandler(apiKeys, ["conversations:read", "messages:read"]) },
    async (request) => {
      if (!/^\d+$/.test(request.params.id)) {
        throw new ApiError(400, "validation_error", "The conversation ID is invalid");
      }
      const page = await resources.listMessages(
        request.apiPrincipal!.companyId,
        Number(request.params.id),
        parsePageQuery(request.query)
      );
      if (page === null) {
        throw new ApiError(404, "conversation_not_found", "The conversation was not found");
      }
      return responsePage(request.id, page);
    }
  );
}
