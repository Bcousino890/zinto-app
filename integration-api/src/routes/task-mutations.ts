import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { createApiKeyAuthenticator, type ApiKeyRepository } from "../auth/api-key.js";
import { assertScopes } from "../auth/scopes.js";
import { allowsAnyWrite, assertWriteEnabled, type WriteAccessPolicy } from "../auth/write-access.js";
import { ApiError } from "../http/errors.js";
import { type IdempotencyRepository, withIdempotency } from "../http/idempotency.js";
import type { RateLimiter } from "../http/rate-limit.js";
import type { TaskMutationInput, TaskMutationPatch, TaskMutationRepository } from "../resources/task-mutations.js";

const nullableText = z.string().trim().max(500).nullable();
const fields = {
  title: z.string().trim().min(1).max(255),
  description: z.string().max(20_000).nullable().optional(),
  priority: z.string().trim().min(1).max(50).optional(),
  status: z.string().trim().min(1).max(50).optional(),
  due_date: z.string().datetime().nullable().optional(),
  assigned_to: nullableText.optional(),
  category: nullableText.optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  background_color: z.string().trim().max(50).nullable().optional()
};
const createSchema = z.object({ contact_id: z.string().regex(/^\d+$/), ...fields }).strict();
const updateSchema = z.object({ ...fields, title: fields.title.optional(), completed_at: z.string().datetime().nullable().optional() }).strict()
  .refine((value) => Object.keys(value).length > 0);

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, "validation_error", "The request body is invalid");
  return result.data;
}

function id(value: string): number {
  if (!/^\d+$/.test(value)) throw new ApiError(400, "validation_error", "The task ID is invalid");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new ApiError(400, "validation_error", "The task ID is invalid");
  return parsed;
}

function assertSafeId(value: string): void {
  if (!Number.isSafeInteger(Number(value))) {
    throw new ApiError(400, "validation_error", "The contact ID is invalid");
  }
}

function protect(apiKeys: ApiKeyRepository, rateLimiter: RateLimiter | undefined, policy: WriteAccessPolicy) {
  const authenticate = createApiKeyAuthenticator(apiKeys, rateLimiter);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    if (allowsAnyWrite(policy)) assertWriteEnabled(policy, request.apiPrincipal!);
    assertScopes(request.apiPrincipal!.scopes, ["tasks:write"]);
  };
}

export function registerTaskMutationRoutes(
  app: FastifyInstance,
  apiKeys: ApiKeyRepository,
  repository: TaskMutationRepository,
  idempotency: IdempotencyRepository,
  rateLimiter: RateLimiter | undefined,
  writeAccessPolicy: WriteAccessPolicy
): void {
  const preHandler = protect(apiKeys, rateLimiter, writeAccessPolicy);
  app.post("/api/v1/tasks", { preHandler }, async (request, reply) => {
    const input = parse<TaskMutationInput>(createSchema, request.body);
    assertSafeId(input.contact_id);
    return withIdempotency(request, reply, idempotency, async () => {
      const data = await repository.createTask(request.apiPrincipal!.companyId, request.apiPrincipal!.userId, input);
      if (data === null) throw new ApiError(404, "contact_not_found", "The contact was not found");
      return { statusCode: 201, body: { data, meta: { request_id: request.id } } };
    });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/tasks/:id", { preHandler }, async (request, reply) => {
    const input = parse<TaskMutationPatch>(updateSchema, request.body);
    return withIdempotency(request, reply, idempotency, async () => {
      const data = await repository.updateTask(request.apiPrincipal!.companyId, id(request.params.id), request.apiPrincipal!.userId, input);
      if (data === null) throw new ApiError(404, "task_not_found", "The task was not found");
      return { statusCode: 200, body: { data, meta: { request_id: request.id } } };
    });
  });

  app.delete<{ Params: { id: string } }>("/api/v1/tasks/:id", { preHandler }, async (request, reply) => {
    return withIdempotency(request, reply, idempotency, async () => {
      const deleted = await repository.deleteTask(request.apiPrincipal!.companyId, id(request.params.id), request.apiPrincipal!.userId);
      if (!deleted) throw new ApiError(404, "task_not_found", "The task was not found");
      return { statusCode: 204, body: null };
    });
  });
}
