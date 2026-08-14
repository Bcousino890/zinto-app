import type { FastifyInstance } from "fastify";

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly headers: Record<string, string> = {}
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
      for (const [name, value] of Object.entries(error.headers)) reply.header(name, value);
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          request_id: request.id
        }
      });
    }

    // Fastify rejects an oversized body before our own error handling ever
    // sees the request; without this, that raw FastifyError would fall
    // through to the generic 500 branch below instead of a canonical 413.
    if ((error as { code?: string }).code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.status(413).send({
        error: {
          code: "payload_too_large",
          message: "The request body exceeds the allowed size",
          request_id: request.id
        }
      });
    }

    if ((error as { code?: string }).code === "FST_ERR_CTP_EMPTY_JSON_BODY") {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: "The request body is invalid",
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
