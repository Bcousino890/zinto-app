import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { createApiKeyAuthenticator, type ApiKeyRepository } from "../auth/api-key.js";
import { assertScopes } from "../auth/scopes.js";
import type { DeliveryClient, DeliveryRequest } from "../delivery/client.js";
import { DeliveryAdapterError } from "../delivery/client.js";
import { assertSafeMediaUrl } from "../delivery/media-url.js";
import { messageBodyLimitBytes } from "../http/body-limits.js";
import { ApiError } from "../http/errors.js";
import { type IdempotencyRepository, withIdempotency } from "../http/idempotency.js";
import type { RateLimiter } from "../http/rate-limit.js";
import type { MediaProxy } from "../media/proxy.js";
import type { HostResolver } from "../net/destination.js";
import type { ChannelResource, CoreRepository } from "../resources/core.js";

const common = {
  channel_id: z.string().regex(/^\d+$/),
  to: z.string().trim().min(1).max(320)
};
const textSchema = z.object({ ...common, message: z.string().min(1).max(4096) }).strict();
const mediaSchema = z.object({
  ...common,
  media_type: z.enum(["image", "video", "audio", "document"]),
  media_url: z.string().url().max(2048),
  caption: z.string().max(1024).optional(),
  filename: z.string().max(255).optional()
}).strict();
const templateSchema = z.object({
  ...common,
  template_name: z.string().trim().min(1).max(255),
  template_language: z.string().trim().min(2).max(10).optional(),
  components: z.array(z.unknown()).optional()
}).strict();
const interactiveSchema = z.object({
  ...common,
  interactive_type: z.enum(["button", "list"]),
  body: z.string().trim().min(1).max(1024),
  header: z.string().max(60).optional(),
  footer: z.string().max(60).optional(),
  action: z.record(z.string(), z.unknown())
}).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, "validation_error", "The request body is invalid");
  return result.data;
}

function protect(apiKeys: ApiKeyRepository, rateLimiter?: RateLimiter) {
  const authenticate = createApiKeyAuthenticator(apiKeys, rateLimiter);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    assertScopes(request.apiPrincipal!.scopes, ["messages:send"]);
  };
}

async function selectChannel(resources: CoreRepository, companyId: number, id: number): Promise<ChannelResource> {
  const result = (await resources.listChannels(companyId)).find((item) => item.id === String(id));
  if (result === undefined) throw new ApiError(404, "channel_not_found", "The channel was not found");
  if (result.status !== "active" && result.status !== "connected") {
    throw new ApiError(409, "channel_inactive", "The channel is not active");
  }
  return result;
}

function bearerToken(request: FastifyRequest): string {
  return request.headers.authorization!.slice("Bearer ".length);
}

function ensureCapability(resource: ChannelResource, capability: string): void {
  if (!resource.capabilities.includes(capability)) {
    throw new ApiError(422, "channel_capability_unsupported", "The channel does not support this message type");
  }
}

async function performDelivery(
  request: FastifyRequest,
  reply: FastifyReply,
  idempotency: IdempotencyRepository,
  delivery: DeliveryClient,
  payload: DeliveryRequest
) {
  return withIdempotency<unknown>(request, reply, idempotency, async () => {
    try {
      const data = await delivery.deliver(payload);
      return { statusCode: 201, body: { data, meta: { request_id: request.id } } };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError" ||
          error instanceof Error && error.name === "TimeoutError") {
        return {
          statusCode: 504,
          body: {
            error: {
              code: "delivery_timeout",
              message: "Delivery status is unknown; retry only after verification",
              request_id: request.id
            }
          }
        };
      }
      if (error instanceof DeliveryAdapterError) {
        // Only the status code is logged: `error.response` is the raw legacy
        // payload, which can carry customer phone numbers or message content.
        request.log.warn({ statusCode: error.statusCode }, "legacy delivery engine rejected the message");
        return {
          statusCode: 502,
          body: {
            error: {
              code: "delivery_failed",
              message: "The delivery engine rejected the message",
              request_id: request.id
            }
          }
        };
      }
      throw error;
    }
  });
}

export function registerMessageSendRoutes(
  app: FastifyInstance,
  apiKeys: ApiKeyRepository,
  resources: CoreRepository,
  idempotency: IdempotencyRepository,
  delivery: DeliveryClient,
  resolveHost?: HostResolver,
  mediaProxy?: MediaProxy,
  rateLimiter?: RateLimiter
): void {
  const preHandler = protect(apiKeys, rateLimiter);
  const routeOptions = { bodyLimit: messageBodyLimitBytes, preHandler };

  app.post("/api/v1/messages/send", routeOptions, async (request, reply) => {
    const input = parse(textSchema, request.body);
    const selected = await selectChannel(resources, request.apiPrincipal!.companyId, Number(input.channel_id));
    ensureCapability(selected, "text");
    return performDelivery(request, reply, idempotency, delivery, {
      kind: "text",
      bearerToken: bearerToken(request),
      channelId: Number(input.channel_id),
      to: input.to,
      message: input.message
    });
  });

  app.post("/api/v1/messages/send-media", routeOptions, async (request, reply) => {
    const input = parse(mediaSchema, request.body);
    const selected = await selectChannel(resources, request.apiPrincipal!.companyId, Number(input.channel_id));
    ensureCapability(selected, "media");
    await assertSafeMediaUrl(input.media_url, resolveHost);
    if (mediaProxy === undefined) {
      // Forwarding the partner URL to the legacy engine unmodified is exactly
      // the rebinding window the proxy exists to close: the engine resolves it
      // again with its own client, outside our pinning. Refusing loudly here
      // means enabling writes can never reopen that window silently.
      throw new ApiError(503, "media_proxy_disabled", "Media delivery is temporarily disabled");
    }
    const mediaUrl = await mediaProxy.prepare(input.media_url, input.media_type);
    return performDelivery(request, reply, idempotency, delivery, {
      kind: "media",
      bearerToken: bearerToken(request),
      channelId: Number(input.channel_id),
      to: input.to,
      mediaType: input.media_type,
      mediaUrl,
      caption: input.caption,
      filename: input.filename
    });
  });

  app.post("/api/v1/messages/send-template", routeOptions, async (request, reply) => {
    const input = parse(templateSchema, request.body);
    const selected = await selectChannel(resources, request.apiPrincipal!.companyId, Number(input.channel_id));
    ensureCapability(selected, "template");
    return performDelivery(request, reply, idempotency, delivery, {
      kind: "template",
      bearerToken: bearerToken(request),
      channelId: Number(input.channel_id),
      to: input.to,
      templateName: input.template_name,
      templateLanguage: input.template_language,
      components: input.components
    });
  });

  app.post("/api/v1/messages/send-interactive", routeOptions, async (request, reply) => {
    const input = parse(interactiveSchema, request.body);
    const selected = await selectChannel(resources, request.apiPrincipal!.companyId, Number(input.channel_id));
    ensureCapability(selected, "interactive");
    return performDelivery(request, reply, idempotency, delivery, {
      kind: "interactive",
      bearerToken: bearerToken(request),
      channelId: Number(input.channel_id),
      to: input.to,
      interactiveType: input.interactive_type,
      body: input.body,
      header: input.header,
      footer: input.footer,
      action: input.action
    });
  });
}
