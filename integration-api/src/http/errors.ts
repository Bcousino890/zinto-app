import type { FastifyInstance } from "fastify";

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

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
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          request_id: request.id
        }
      });
    }

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
