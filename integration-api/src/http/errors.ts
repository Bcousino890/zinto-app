import type { FastifyInstance } from "fastify";

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: {
        code: "not_found",
        message: "Route not found",
        request_id: request.id
      }
    });
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "request failed");
    return reply.status(500).send({
      error: {
        code: "internal_error",
        message: "An unexpected error occurred",
        request_id: request.id
      }
    });
  });
}
