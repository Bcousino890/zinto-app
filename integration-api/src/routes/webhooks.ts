import { randomBytes } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { createApiKeyAuthenticator, type ApiKeyRepository } from "../auth/api-key.js";
import { assertScopes } from "../auth/scopes.js";
import { webhookBodyLimitBytes } from "../http/body-limits.js";
import { ApiError } from "../http/errors.js";
import { assertSafeDestination, type HostResolver } from "../net/destination.js";
import type { WebhookRepository } from "../webhooks/repository.js";

export const webhookEventTypes = [
  "contact.created", "contact.updated", "contact.deleted",
  "conversation.created", "conversation.updated",
  "message.created", "message.status.updated",
  "note.created", "note.updated", "note.deleted",
  "tag.attached", "tag.detached",
  "deal.created", "deal.updated", "deal.stage.changed", "deal.deleted",
  "task.created", "task.updated", "task.completed", "task.deleted",
  "channel.connection.updated"
] as const;

const createSchema = z.object({
  url: z.string().url().max(2048),
  event_types: z.array(z.enum(webhookEventTypes)).min(1).max(webhookEventTypes.length)
}).strict();

function protect(apiKeys: ApiKeyRepository) {
  const authenticate = createApiKeyAuthenticator(apiKeys);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    assertScopes(request.apiPrincipal!.scopes, ["webhooks:manage"]);
  };
}

/**
 * Registration resolves DNS instead of only inspecting the literal hostname, so
 * a name that points at loopback or cloud metadata is refused at creation time
 * rather than at the first delivery attempt.
 */
async function assertSafeWebhookUrl(value: string, resolve?: HostResolver): Promise<void> {
  try {
    await assertSafeDestination(value, { protocols: ["https:"], resolve });
  } catch {
    throw new ApiError(400, "unsafe_webhook_url", "The webhook URL is not safe");
  }
}

export function registerWebhookRoutes(
  app: FastifyInstance,
  apiKeys: ApiKeyRepository,
  repository: WebhookRepository,
  resolveHost?: HostResolver
): void {
  const preHandler = protect(apiKeys);

  app.post("/api/v1/webhooks", { bodyLimit: webhookBodyLimitBytes, preHandler }, async (request, reply) => {
    const result = createSchema.safeParse(request.body);
    if (!result.success) throw new ApiError(400, "validation_error", "The request body is invalid");
    await assertSafeWebhookUrl(result.data.url, resolveHost);
    const secret = `whsec_${randomBytes(32).toString("hex")}`;
    const endpoint = await repository.create(
      request.apiPrincipal!.companyId,
      request.apiPrincipal!.apiKeyId,
      { url: result.data.url, eventTypes: result.data.event_types, secret }
    );
    return reply.status(201).send({
      data: { ...endpoint, secret },
      meta: { request_id: request.id }
    });
  });

  app.get("/api/v1/webhooks", { preHandler }, async (request) => ({
    data: await repository.list(request.apiPrincipal!.companyId),
    meta: { request_id: request.id }
  }));

  app.delete<{ Params: { id: string } }>(
    "/api/v1/webhooks/:id",
    { preHandler },
    async (request, reply) => {
      if (!/^\d+$/.test(request.params.id)) {
        throw new ApiError(400, "validation_error", "The webhook ID is invalid");
      }
      if (!await repository.disable(request.apiPrincipal!.companyId, Number(request.params.id))) {
        throw new ApiError(404, "webhook_not_found", "The webhook was not found");
      }
      return reply.status(204).send();
    }
  );
}
