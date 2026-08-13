import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import type { ApiKeyRepository } from "./auth/api-key.js";
import { registerErrorHandlers } from "./http/errors.js";
import type { CoreRepository } from "./resources/core.js";
import { registerCoreRoutes } from "./routes/core.js";
import { registerMeRoute } from "./routes/me.js";

export interface AppOptions {
  apiKeyRepository?: ApiKeyRepository;
  coreRepository?: CoreRepository;
  logger?: FastifyServerOptions["logger"];
  onClose?: () => Promise<void>;
  trustProxy?: FastifyServerOptions["trustProxy"];
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    genReqId: () => `req_${randomUUID()}`,
    logger: options.logger ?? true,
    trustProxy: options.trustProxy ?? false
  });
  app.decorateRequest("apiPrincipal", null);

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

  if (options.apiKeyRepository !== undefined) {
    registerMeRoute(app, options.apiKeyRepository);
    if (options.coreRepository !== undefined) {
      registerCoreRoutes(app, options.apiKeyRepository, options.coreRepository);
    }
  }
  if (options.onClose !== undefined) {
    app.addHook("onClose", options.onClose);
  }

  registerErrorHandlers(app);
  await app.ready();
  return app;
}
