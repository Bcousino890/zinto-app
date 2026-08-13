import type { FastifyInstance } from "fastify";

import type { ApiKeyRepository } from "../auth/api-key.js";
import { createApiKeyAuthenticator } from "../auth/api-key.js";
import type { RateLimiter } from "../http/rate-limit.js";

export function registerMeRoute(app: FastifyInstance, repository: ApiKeyRepository, rateLimiter?: RateLimiter): void {
  app.get(
    "/api/v1/me",
    { preHandler: createApiKeyAuthenticator(repository, rateLimiter) },
    async (request) => {
      const principal = request.apiPrincipal!;
      return {
        data: {
          api_key: { id: String(principal.apiKeyId), name: principal.apiKeyName },
          company: { id: String(principal.companyId), name: principal.companyName },
          scopes: principal.scopes
        },
        meta: { request_id: request.id }
      };
    }
  );
}
