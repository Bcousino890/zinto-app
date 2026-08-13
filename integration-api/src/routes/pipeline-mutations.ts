import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { createApiKeyAuthenticator, type ApiKeyRepository } from "../auth/api-key.js";
import { assertScopes } from "../auth/scopes.js";
import { allowsAnyWrite, assertWriteEnabled, type WriteAccessPolicy } from "../auth/write-access.js";
import { ApiError } from "../http/errors.js";
import type { RateLimiter } from "../http/rate-limit.js";
import type {
  DealStageChangeFailure,
  PipelineMutationRepository
} from "../resources/pipeline-mutations.js";

const stageChangeSchema = z.object({ stage_id: z.string().regex(/^\d+$/) }).strict();

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

function identifier(value: string, resource: string): number {
  if (!/^\d+$/.test(value)) {
    throw new ApiError(400, "validation_error", `The ${resource} ID is invalid`);
  }
  return Number(value);
}

/**
 * Un deal ajeno y un deal inexistente devuelven la misma respuesta: la ruta
 * nunca confirma que el identificador existe en otra empresa. El desajuste de
 * pipeline es 422 por el mismo criterio que `channel_capability_unsupported`:
 * la peticion esta bien formada pero es incompatible con el estado del recurso.
 */
function failure(reason: DealStageChangeFailure): ApiError {
  switch (reason) {
    case "deal_not_found":
      return new ApiError(404, "deal_not_found", "The deal was not found");
    case "stage_not_found":
      return new ApiError(404, "stage_not_found", "The pipeline stage was not found");
    case "pipeline_mismatch":
      return new ApiError(
        422,
        "stage_pipeline_mismatch",
        "The stage belongs to a different pipeline than the deal"
      );
  }
}

export function registerPipelineMutationRoutes(
  app: FastifyInstance,
  apiKeys: ApiKeyRepository,
  repository: PipelineMutationRepository,
  rateLimiter?: RateLimiter,
  writeAccessPolicy?: WriteAccessPolicy
): void {
  app.patch<{ Params: { id: string } }>(
    "/api/v1/deals/:id/stage",
    { preHandler: protect(apiKeys, "deals:write", rateLimiter, writeAccessPolicy) },
    async (request) => {
      const dealId = identifier(request.params.id, "deal");
      const parsed = stageChangeSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ApiError(400, "validation_error", "The request body is invalid");
      }

      const result = await repository.changeDealStage(
        request.apiPrincipal!.companyId,
        dealId,
        request.apiPrincipal!.userId,
        Number(parsed.data.stage_id)
      );
      if (!result.ok) throw failure(result.reason);
      return { data: result.deal, meta: { request_id: request.id } };
    }
  );
}
