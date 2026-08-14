import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { createApiKeyAuthenticator, type ApiKeyRepository } from "../auth/api-key.js";
import { assertScopes } from "../auth/scopes.js";
import { allowsAnyWrite, assertWriteEnabled, type WriteAccessPolicy } from "../auth/write-access.js";
import { ApiError } from "../http/errors.js";
import { type IdempotencyRepository, withIdempotency } from "../http/idempotency.js";
import type { RateLimiter } from "../http/rate-limit.js";
import type { ContactMutationRepository } from "../resources/contact-mutations.js";

const nullableString = z.string().max(500).nullable();
const contactFields = {
  name: z.string().trim().min(1).max(255),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().trim().min(3).max(50).nullable().optional(),
  avatar_url: z.string().url().max(2048).nullable().optional(),
  company: nullableString.optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  source: nullableString.optional(),
  notes: z.string().max(20_000).nullable().optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional()
};
const createContactSchema = z.object(contactFields).strict();
const updateContactSchema = z.object({ ...contactFields, name: contactFields.name.optional() }).strict()
  .refine((value) => Object.keys(value).length > 0);
const noteSchema = z.object({ content: z.string().trim().min(1).max(20_000) }).strict();
const tagSchema = z.string().trim().min(1).max(100);

function isDuplicateContactPhoneError(error: unknown): boolean {
  const databaseError = error as { code?: unknown; constraint?: unknown };
  return databaseError.code === "23505" && databaseError.constraint === "idx_contacts_unique_phone_company";
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, "validation_error", "The request body is invalid");
  return result.data;
}

function id(value: string, resource: string): number {
  if (!/^\d+$/.test(value)) throw new ApiError(400, "validation_error", `The ${resource} ID is invalid`);
  return Number(value);
}

function protect(
  apiKeys: ApiKeyRepository,
  scope: string,
  rateLimiter?: RateLimiter,
  writeAccessPolicy?: WriteAccessPolicy
) {
  const authenticate = createApiKeyAuthenticator(apiKeys, rateLimiter);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    if (writeAccessPolicy !== undefined && allowsAnyWrite(writeAccessPolicy)) {
      assertWriteEnabled(writeAccessPolicy, request.apiPrincipal!);
    }
    assertScopes(request.apiPrincipal!.scopes, [scope]);
  };
}

export function registerContactMutationRoutes(
  app: FastifyInstance,
  apiKeys: ApiKeyRepository,
  repository: ContactMutationRepository,
  idempotency: IdempotencyRepository,
  rateLimiter?: RateLimiter,
  writeAccessPolicy?: WriteAccessPolicy
): void {
  app.post("/api/v1/contacts", { preHandler: protect(apiKeys, "contacts:write", rateLimiter, writeAccessPolicy) }, async (request, reply) => {
    const input = parse(createContactSchema, request.body);
    return withIdempotency(request, reply, idempotency, async () => {
      let data;
      try {
        data = await repository.createContact(
          request.apiPrincipal!.companyId,
          request.apiPrincipal!.userId,
          input
        );
      } catch (error) {
        if (isDuplicateContactPhoneError(error)) {
          throw new ApiError(409, "contact_already_exists", "A contact with this phone already exists");
        }
        throw error;
      }
      return { statusCode: 201, body: { data, meta: { request_id: request.id } } };
    });
  });

  app.patch<{ Params: { id: string } }>(
    "/api/v1/contacts/:id",
    { preHandler: protect(apiKeys, "contacts:write", rateLimiter, writeAccessPolicy) },
    async (request) => {
      const data = await repository.updateContact(
        request.apiPrincipal!.companyId,
        id(request.params.id, "contact"),
        parse(updateContactSchema, request.body)
      );
      if (data === null) throw new ApiError(404, "contact_not_found", "The contact was not found");
      return { data, meta: { request_id: request.id } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/v1/contacts/:id",
    { preHandler: protect(apiKeys, "contacts:write", rateLimiter, writeAccessPolicy) },
    async (request) => {
      const data = await repository.archiveContact(
        request.apiPrincipal!.companyId,
        id(request.params.id, "contact")
      );
      if (data === null) throw new ApiError(404, "contact_not_found", "The contact was not found");
      return { data, meta: { request_id: request.id } };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/contacts/:id/notes",
    { preHandler: protect(apiKeys, "notes:write", rateLimiter, writeAccessPolicy) },
    async (request, reply) => {
      const input = parse(noteSchema, request.body);
      return withIdempotency(request, reply, idempotency, async () => {
        const data = await repository.createNote(
          request.apiPrincipal!.companyId,
          id(request.params.id, "contact"),
          request.apiPrincipal!.userId,
          input.content
        );
        if (data === null) throw new ApiError(404, "contact_not_found", "The contact was not found");
        return { statusCode: 201, body: { data, meta: { request_id: request.id } } };
      });
    }
  );

  app.patch<{ Params: { id: string } }>(
    "/api/v1/notes/:id",
    { preHandler: protect(apiKeys, "notes:write", rateLimiter, writeAccessPolicy) },
    async (request) => {
      const input = parse(noteSchema, request.body);
      const data = await repository.updateNote(
        request.apiPrincipal!.companyId,
        id(request.params.id, "note"),
        input.content
      );
      if (data === null) throw new ApiError(404, "note_not_found", "The note was not found");
      return { data, meta: { request_id: request.id } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/v1/notes/:id",
    { preHandler: protect(apiKeys, "notes:write", rateLimiter, writeAccessPolicy) },
    async (request, reply) => {
      const deleted = await repository.deleteNote(
        request.apiPrincipal!.companyId,
        id(request.params.id, "note")
      );
      if (!deleted) throw new ApiError(404, "note_not_found", "The note was not found");
      return reply.status(204).send();
    }
  );

  app.put<{ Params: { id: string; tag: string } }>(
    "/api/v1/contacts/:id/tags/:tag",
    { preHandler: protect(apiKeys, "tags:write", rateLimiter, writeAccessPolicy) },
    async (request) => {
      const tag = parse(tagSchema, request.params.tag);
      const data = await repository.attachTag(
        request.apiPrincipal!.companyId,
        id(request.params.id, "contact"),
        tag
      );
      if (data === null) throw new ApiError(404, "contact_not_found", "The contact was not found");
      return { data, meta: { request_id: request.id } };
    }
  );

  app.delete<{ Params: { id: string; tag: string } }>(
    "/api/v1/contacts/:id/tags/:tag",
    { preHandler: protect(apiKeys, "tags:write", rateLimiter, writeAccessPolicy) },
    async (request) => {
      const tag = parse(tagSchema, request.params.tag);
      const data = await repository.detachTag(
        request.apiPrincipal!.companyId,
        id(request.params.id, "contact"),
        tag
      );
      if (data === null) throw new ApiError(404, "contact_not_found", "The contact was not found");
      return { data, meta: { request_id: request.id } };
    }
  );
}
