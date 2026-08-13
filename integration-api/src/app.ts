import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import type { ApiKeyRepository } from "./auth/api-key.js";
import type { DeliveryClient } from "./delivery/client.js";
import type { MediaProxy } from "./media/proxy.js";
import type { MediaStore } from "./media/store.js";
import type { HostResolver } from "./net/destination.js";
import { registerMediaRoutes } from "./routes/media.js";
import type { IdempotencyRepository } from "./http/idempotency.js";
import type { ContactMutationRepository } from "./resources/contact-mutations.js";
import type { DeliveryAuditRepository } from "./resources/delivery-audit.js";
import type { WebhookRepository } from "./webhooks/repository.js";
import { globalBodyLimitBytes } from "./http/body-limits.js";
import { ApiError, registerErrorHandlers } from "./http/errors.js";
import { secureLoggerOptions } from "./http/logging.js";
import { createIpRateLimitHook, defaultRateLimitConfig, RateLimiter } from "./http/rate-limit.js";
import type { CoreRepository } from "./resources/core.js";
import type { PipelineRepository } from "./resources/pipelines.js";
import { registerCoreRoutes } from "./routes/core.js";
import { registerContactMutationRoutes } from "./routes/contact-mutations.js";
import { registerMeRoute } from "./routes/me.js";
import { registerPipelineRoutes } from "./routes/pipelines.js";
import { registerMessageSendRoutes } from "./routes/message-send.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";

export interface AppOptions {
  apiKeyRepository?: ApiKeyRepository;
  contactMutationRepository?: ContactMutationRepository;
  coreRepository?: CoreRepository;
  deliveryAuditRepository?: DeliveryAuditRepository;
  deliveryClient?: DeliveryClient;
  hostResolver?: HostResolver;
  idempotencyRepository?: IdempotencyRepository;
  logger?: FastifyServerOptions["logger"];
  mediaProxy?: MediaProxy;
  mediaStore?: MediaStore;
  onClose?: () => Promise<void>;
  pipelineRepository?: PipelineRepository;
  rateLimiter?: RateLimiter;
  readOnly?: boolean;
  readinessCheck?: () => Promise<void>;
  trustProxy?: FastifyServerOptions["trustProxy"];
  webhookRepository?: WebhookRepository;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: globalBodyLimitBytes,
    genReqId: () => `req_${randomUUID()}`,
    logger: options.logger ?? secureLoggerOptions(),
    trustProxy: options.trustProxy ?? false
  });
  app.decorateRequest("apiPrincipal", null);

  const rateLimiter = options.rateLimiter ?? new RateLimiter(defaultRateLimitConfig);
  app.addHook("onRequest", createIpRateLimitHook(rateLimiter));

  app.addHook("onRequest", async (request) => {
    const readOnly = options.readOnly ?? true;
    if (readOnly && request.url.startsWith("/api/v1/") &&
        !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      throw new ApiError(503, "read_only_mode", "Write operations are temporarily disabled");
    }
  });

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.get("/health", async (request) => ({
    data: {
      service: "zinto-integration-api",
      status: "ok",
      version: "0.1.0"
    },
    meta: {
      request_id: request.id
    }
  }));

  app.get("/ready", async (request, reply) => {
    try {
      await options.readinessCheck?.();
      return {
        data: {
          service: "zinto-integration-api",
          status: "ready",
          version: "0.1.0"
        },
        meta: { request_id: request.id }
      };
    } catch {
      return reply.status(503).send({
        error: {
          code: "service_not_ready",
          message: "A required service is unavailable",
          request_id: request.id
        }
      });
    }
  });

  if (options.apiKeyRepository !== undefined) {
    registerMeRoute(app, options.apiKeyRepository, rateLimiter);
    if (options.coreRepository !== undefined) {
      registerCoreRoutes(app, options.apiKeyRepository, options.coreRepository, rateLimiter);
    }
    if (options.pipelineRepository !== undefined) {
      registerPipelineRoutes(app, options.apiKeyRepository, options.pipelineRepository);
    }
    if (options.contactMutationRepository !== undefined && options.idempotencyRepository !== undefined) {
      registerContactMutationRoutes(
        app,
        options.apiKeyRepository,
        options.contactMutationRepository,
        options.idempotencyRepository,
        rateLimiter
      );
    }
    if (options.coreRepository !== undefined && options.idempotencyRepository !== undefined &&
        options.deliveryClient !== undefined) {
      registerMessageSendRoutes(
        app,
        options.apiKeyRepository,
        options.coreRepository,
        options.idempotencyRepository,
        options.deliveryClient,
        options.hostResolver,
        options.mediaProxy,
        rateLimiter,
        options.deliveryAuditRepository
      );
    }
    if (options.webhookRepository !== undefined) {
      registerWebhookRoutes(
        app,
        options.apiKeyRepository,
        options.webhookRepository,
        options.hostResolver,
        rateLimiter
      );
    }
  }
  // Served without an API key because the delivery engine fetches it without the
  // partner's credentials; the reverse proxy denies the prefix publicly.
  if (options.mediaStore !== undefined) {
    registerMediaRoutes(app, options.mediaStore);
  }
  if (options.onClose !== undefined) {
    app.addHook("onClose", options.onClose);
  }

  registerErrorHandlers(app);
  await app.ready();
  return app;
}
