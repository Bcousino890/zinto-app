import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { createApiKeyAuthenticator, type ApiKeyRepository } from "../auth/api-key.js";
import { assertScopes } from "../auth/scopes.js";
import { allowsAnyWrite, assertWriteEnabled, type WriteAccessPolicy } from "../auth/write-access.js";
import { ApiError } from "../http/errors.js";
import type { RateLimiter } from "../http/rate-limit.js";
import type {
  ConversationCreateFailure,
  ConversationMutationRepository
} from "../resources/conversation-mutations.js";

/**
 * `.strict()` rechaza cualquier campo desconocido, incluido un `channel_type`
 * que el partner intentase imponer: ese valor se deriva siempre del canal real.
 */
const createConversationSchema = z.object({
  contact_id: z.string().regex(/^\d+$/),
  channel_id: z.string().regex(/^\d+$/)
}).strict();

function protect(
  apiKeys: ApiKeyRepository,
  scope: string,
  rateLimiter?: RateLimiter,
  writeAccessPolicy?: WriteAccessPolicy
) {
  const authenticate = createApiKeyAuthenticator(apiKeys, rateLimiter);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    if (writeAccessPolicy !== undefined && allowsAnyWrite(writeAccessPolicy)) {
      assertWriteEnabled(writeAccessPolicy, request.apiPrincipal!);
    }
    assertScopes(request.apiPrincipal!.scopes, [scope]);
  };
}

/**
 * Un contacto o un canal de otra empresa devuelven exactamente lo mismo que uno
 * inexistente: la ruta nunca confirma que el identificador existe en otra parte.
 */
function failure(reason: ConversationCreateFailure): ApiError {
  switch (reason) {
    case "contact_not_found":
      return new ApiError(404, "contact_not_found", "The contact was not found");
    case "channel_not_found":
      return new ApiError(404, "channel_not_found", "The channel was not found");
  }
}

export function registerConversationMutationRoutes(
  app: FastifyInstance,
  apiKeys: ApiKeyRepository,
  repository: ConversationMutationRepository,
  rateLimiter?: RateLimiter,
  writeAccessPolicy?: WriteAccessPolicy
): void {
  app.post(
    "/api/v1/conversations",
    { preHandler: protect(apiKeys, "conversations:write", rateLimiter, writeAccessPolicy) },
    async (request, reply) => {
      const parsed = createConversationSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ApiError(400, "validation_error", "The request body is invalid");
      }

      const result = await repository.findOrCreateConversation(
        request.apiPrincipal!.companyId,
        Number(parsed.data.contact_id),
        Number(parsed.data.channel_id),
        request.apiPrincipal!.userId
      );
      if (!result.ok) throw failure(result.reason);

      // 201 solo cuando la fila es nueva; reencontrar la conversacion existente
      // es un 200, para que el partner pueda distinguir los dos casos sin tener
      // que comparar identificadores por su cuenta.
      return reply
        .status(result.created ? 201 : 200)
        .send({ data: result.conversation, meta: { request_id: request.id } });
    }
  );
}
