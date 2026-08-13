import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import type { ApiKeyRepository } from "./auth/api-key.js";
import type { DeliveryClient } from "./delivery/client.js";
import type { HostResolver } from "./net/destination.js";
import type { IdempotencyRepository } from "./http/idempotency.js";
import type { ContactMutationRepository } from "./resources/contact-mutations.js";
import type { WebhookRepository } from "./webhooks/repository.js";
import { ApiError, registerErrorHandlers } from "./http/errors.js";
import type { CoreRepository } from "./resources/core.js";
import { registerCoreRoutes } from "./routes/core.js";
import { registerContactMutationRoutes } from "./routes/contact-mutations.js";
import { registerMeRoute } from "./routes/me.js";
import { registerMessageSendRoutes } from "./routes/message-send.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";

export interface AppOptions {
  apiKeyRepository?: ApiKeyRepository;
  contactMutationRepository?: ContactMutationRepository;
  coreRepository?: CoreRepository;
  deliveryClient?: DeliveryClient;
  hostResolver?: HostResolver;
  idempotencyRepository?: IdempotencyRepository;
  logger?: FastifyServerOptions["logger"];
  onClose?: () => Promise<void>;
  readOnly?: boolean;
  readinessCheck?: () => Promise<void>;
  trustProxy?: FastifyServerOptions["trustProxy"];
  webhookRepository?: WebhookRepository;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    genReqId: () => `req_${randomUUID()}`,
    logger: options.logger ?? true,
    trustProxy: options.trustProxy ?? false
  });
  app.decorateRequest("apiPrincipal", null);

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
    registerMeRoute(app, options.apiKeyRepository);
    if (options.coreRepository !== undefined) {
      registerCoreRoutes(app, options.apiKeyRepository, options.coreRepository);
    }
    if (options.contactMutationRepository !== undefined && options.idempotencyRepository !== undefined) {
      registerContactMutationRoutes(
        app,
        options.apiKeyRepository,
        options.contactMutationRepository,
        options.idempotencyRepository
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
        options.hostResolver
      );
    }
    if (options.webhookRepository !== undefined) {
      registerWebhookRoutes(
        app,
        options.apiKeyRepository,
        options.webhookRepository,
        options.hostResolver
      );
    }
  }
  if (options.onClose !== undefined) {
    app.addHook("onClose", options.onClose);
  }

  registerErrorHandlers(app);
  await app.ready();
  return app;
}
