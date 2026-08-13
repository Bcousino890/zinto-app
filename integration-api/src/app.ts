import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyServerOptions } from "fastify";

import type { ApiKeyRepository } from "./auth/api-key.js";
import { allowsAnyWrite, type WriteAccessPolicy } from "./auth/write-access.js";
import type { DeliveryClient } from "./delivery/client.js";
import type { MediaProxy } from "./media/proxy.js";
import type { MediaStore } from "./media/store.js";
import type { HostResolver } from "./net/destination.js";
import { registerMediaRoutes } from "./routes/media.js";
import type { MetricsQueries, MetricsRegistry } from "./http/metrics.js";
import { registerMetricsRoute } from "./routes/metrics.js";
import type { IdempotencyRepository } from "./http/idempotency.js";
import type { ContactMutationRepository } from "./resources/contact-mutations.js";
import type { ConversationMutationRepository } from "./resources/conversation-mutations.js";
import type { DeliveryAuditRepository } from "./resources/delivery-audit.js";
import type { WebhookRepository } from "./webhooks/repository.js";
import { globalBodyLimitBytes } from "./http/body-limits.js";
import { ApiError, registerErrorHandlers } from "./http/errors.js";
import { secureLoggerOptions } from "./http/logging.js";
import { createIpRateLimitHook, defaultRateLimitConfig, RateLimiter } from "./http/rate-limit.js";
import type { CoreRepository } from "./resources/core.js";
import type { PipelineMutationRepository } from "./resources/pipeline-mutations.js";
import type { PipelineCrudRepository } from "./resources/pipeline-crud.js";
import type { PipelineRepository } from "./resources/pipelines.js";
import type { FlowReadRepository } from "./resources/flow-reads.js";
import type { ErpReadRepository } from "./resources/erp-read.js";
import type { DealMutationRepository } from "./resources/deal-mutations.js";
import type { TaskMutationRepository } from "./resources/task-mutations.js";
import { registerCoreRoutes } from "./routes/core.js";
import { registerContactMutationRoutes } from "./routes/contact-mutations.js";
import { registerConversationMutationRoutes } from "./routes/conversation-mutations.js";
import { registerMeRoute } from "./routes/me.js";
import { registerPipelineMutationRoutes } from "./routes/pipeline-mutations.js";
import { registerPipelineCrudRoutes } from "./routes/pipeline-crud.js";
import { registerPipelineRoutes } from "./routes/pipelines.js";
import { registerFlowReadRoutes } from "./routes/flow-reads.js";
import { registerErpReadRoutes } from "./routes/erp-read.js";
import { registerDealMutationRoutes } from "./routes/deal-mutations.js";
import { registerTaskMutationRoutes } from "./routes/task-mutations.js";
import { registerMessageSendRoutes } from "./routes/message-send.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";

export interface AppOptions {
  apiKeyRepository?: ApiKeyRepository;
  contactMutationRepository?: ContactMutationRepository;
  conversationMutationRepository?: ConversationMutationRepository;
  coreRepository?: CoreRepository;
  deliveryAuditRepository?: DeliveryAuditRepository;
  deliveryClient?: DeliveryClient;
  hostResolver?: HostResolver;
  idempotencyRepository?: IdempotencyRepository;
  logger?: FastifyServerOptions["logger"];
  mediaProxy?: MediaProxy;
  mediaStore?: MediaStore;
  metricsQueries?: MetricsQueries;
  metricsRegistry?: MetricsRegistry;
  onClose?: () => Promise<void>;
  pipelineMutationRepository?: PipelineMutationRepository;
  pipelineCrudRepository?: PipelineCrudRepository;
  pipelineRepository?: PipelineRepository;
  flowReadRepository?: FlowReadRepository;
  erpReadRepository?: ErpReadRepository;
  dealMutationRepository?: DealMutationRepository;
  taskMutationRepository?: TaskMutationRepository;
  rateLimiter?: RateLimiter;
  readOnly?: boolean;
  readinessCheck?: () => Promise<void>;
  trustProxy?: FastifyServerOptions["trustProxy"];
  webhookRepository?: WebhookRepository;
  writeEnabledApiKeyIds?: ReadonlySet<number>;
  writeEnabledCompanyIds?: ReadonlySet<number>;
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
  const writeAccessPolicy: WriteAccessPolicy = {
    enabledApiKeyIds: options.writeEnabledApiKeyIds ?? new Set<number>(),
    enabledCompanyIds: options.writeEnabledCompanyIds ?? new Set<number>(),
    readOnly: options.readOnly ?? true
  };
  app.addHook("onRequest", createIpRateLimitHook(rateLimiter));

  const readOnly = writeAccessPolicy.readOnly;
  function isApiMutation(request: FastifyRequest): boolean {
    return request.url.startsWith("/api/v1/") && !["GET", "HEAD", "OPTIONS"].includes(request.method);
  }

  if (readOnly && !allowsAnyWrite(writeAccessPolicy)) {
    app.addHook("onRequest", async (request) => {
      if (isApiMutation(request)) {
        throw new ApiError(503, "read_only_mode", "Write operations are temporarily disabled");
      }
    });
  }

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  // Only wired up when a registry is supplied (src/server.ts only builds one
  // when METRICS_ENABLED is true) so there is zero per-request overhead while
  // the feature is off, matching the "no cost when disabled" bar the rest of
  // this file holds optional integrations to.
  if (options.metricsRegistry !== undefined) {
    const metricsRegistry = options.metricsRegistry;
    app.addHook("onResponse", async (request, reply) => {
      // request.routeOptions.url is the route *pattern* Fastify matched
      // (e.g. "/api/v1/contacts/:id"), not the literal URL - using the
      // literal URL here would let one metrics series be created per real
      // contact/deal/etc id a partner ever requests. It is undefined for
      // requests that never matched a route (404s), which are collapsed onto
      // a single fixed label instead of being dropped, so the 404 rate is
      // still visible.
      const route = request.routeOptions.url ?? "unmatched_route";
      metricsRegistry.recordResponse(request.method, route, reply.statusCode, reply.elapsedTime);
    });
  }

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
    if (options.flowReadRepository !== undefined) {
      registerFlowReadRoutes(app, options.apiKeyRepository, options.flowReadRepository);
    }
    if (options.erpReadRepository !== undefined) {
      registerErpReadRoutes(app, options.apiKeyRepository, options.erpReadRepository, rateLimiter);
    }
    if (options.pipelineMutationRepository !== undefined) {
      registerPipelineMutationRoutes(
        app,
        options.apiKeyRepository,
        options.pipelineMutationRepository,
        rateLimiter,
        writeAccessPolicy
      );
    }
    if (options.pipelineCrudRepository !== undefined && options.idempotencyRepository !== undefined) {
      registerPipelineCrudRoutes(app, options.apiKeyRepository, options.pipelineCrudRepository,
        options.idempotencyRepository, rateLimiter, writeAccessPolicy);
    }
    if (options.dealMutationRepository !== undefined && options.idempotencyRepository !== undefined) {
      registerDealMutationRoutes(app, options.apiKeyRepository, options.dealMutationRepository,
        options.idempotencyRepository, rateLimiter, writeAccessPolicy);
    }
    if (options.taskMutationRepository !== undefined && options.idempotencyRepository !== undefined) {
      registerTaskMutationRoutes(
        app,
        options.apiKeyRepository,
        options.taskMutationRepository,
        options.idempotencyRepository,
        rateLimiter,
        writeAccessPolicy
      );
    }
    if (options.conversationMutationRepository !== undefined) {
      registerConversationMutationRoutes(
        app,
        options.apiKeyRepository,
        options.conversationMutationRepository,
        rateLimiter,
        writeAccessPolicy,
        options.idempotencyRepository
      );
    }
    if (options.contactMutationRepository !== undefined && options.idempotencyRepository !== undefined) {
      registerContactMutationRoutes(
        app,
        options.apiKeyRepository,
        options.contactMutationRepository,
        options.idempotencyRepository,
        rateLimiter,
        writeAccessPolicy
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
        options.deliveryAuditRepository,
        writeAccessPolicy
      );
    }
    if (options.webhookRepository !== undefined) {
      registerWebhookRoutes(
        app,
        options.apiKeyRepository,
        options.webhookRepository,
        options.hostResolver,
        rateLimiter,
        writeAccessPolicy
      );
    }
  }
  // Served without an API key because the delivery engine fetches it without the
  // partner's credentials; the reverse proxy denies the prefix publicly.
  if (options.mediaStore !== undefined) {
    registerMediaRoutes(app, options.mediaStore);
  }
  // Requires both: the registry the onResponse hook above fed, and something
  // that can answer the outbox/webhook queries at scrape time. src/server.ts
  // only constructs either when METRICS_ENABLED is true, so this route
  // simply does not exist (404, not a "disabled" error) otherwise - see
  // docs/api/METRICS-2026-08-13.md.
  if (options.metricsRegistry !== undefined && options.metricsQueries !== undefined) {
    registerMetricsRoute(app, options.metricsRegistry, options.metricsQueries);
  }
  if (options.onClose !== undefined) {
    app.addHook("onClose", options.onClose);
  }

  registerErrorHandlers(app);
  await app.ready();
  return app;
}
