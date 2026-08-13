import { createHash } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import { ApiError } from "./errors.js";

export interface IdempotencyScope {
  apiKeyId: number;
  method: string;
  path: string;
  key: string;
}

export interface IdempotencyRecord {
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
}

export interface IdempotencyRepository {
  find(scope: IdempotencyScope): Promise<IdempotencyRecord | null>;
  save(scope: IdempotencyScope, record: IdempotencyRecord): Promise<void>;
  runExclusive<T>(scope: IdempotencyScope, operation: () => Promise<T>): Promise<T>;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function withIdempotency<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  repository: IdempotencyRepository,
  operation: () => Promise<{ statusCode: number; body: T }>
): Promise<T> {
  const keyHeader = request.headers["idempotency-key"];
  const key = Array.isArray(keyHeader) ? undefined : keyHeader?.trim();
  if (!key) {
    throw new ApiError(400, "idempotency_key_required", "An Idempotency-Key header is required");
  }
  if (key.length > 255) {
    throw new ApiError(400, "validation_error", "The idempotency key is too long");
  }

  const scope: IdempotencyScope = {
    apiKeyId: request.apiPrincipal!.apiKeyId,
    method: request.method,
    path: request.routeOptions.url ?? request.url.split("?")[0]!,
    key
  };
  return repository.runExclusive(scope, async () => {
    const requestHash = createHash("sha256").update(stableJson(request.body ?? null)).digest("hex");
    const existing = await repository.find(scope);
    if (existing !== null) {
      if (existing.requestHash !== requestHash) {
        throw new ApiError(409, "idempotency_conflict", "The idempotency key was used with a different request");
      }
      reply.header("idempotent-replayed", "true").status(existing.statusCode);
      return existing.responseBody as T;
    }

    const result = await operation();
    await repository.save(scope, {
      requestHash,
      statusCode: result.statusCode,
      responseBody: result.body
    });
    reply.status(result.statusCode);
    return result.body;
  });
}
