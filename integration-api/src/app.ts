import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import { registerErrorHandlers } from "./http/errors.js";

export interface AppOptions {
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    genReqId: () => `req_${randomUUID()}`,
    logger: options.logger ?? true
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

  registerErrorHandlers(app);
  await app.ready();
  return app;
}
