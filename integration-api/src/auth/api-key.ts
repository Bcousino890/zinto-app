import { createHash } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import { ApiError } from "../http/errors.js";
export { assertScopes } from "./scopes.js";

export interface ApiKeyRecord {
  id: number;
  companyId: number;
  companyName: string;
  userId: number;
  name: string;
  keyHash: string;
  permissions: string[];
  isActive: boolean;
  expiresAt: Date | null;
  allowedIps: string[];
}

export interface ApiPrincipal {
  apiKeyId: number;
  apiKeyName: string;
  companyId: number;
  companyName: string;
  userId: number;
  scopes: string[];
}

export interface ApiKeyRepository {
  findByHash(hash: string): Promise<ApiKeyRecord | null>;
  markUsed(apiKeyId: number): Promise<void>;
}

declare module "fastify" {
  interface FastifyRequest {
    apiPrincipal: ApiPrincipal | null;
  }
}

const bearerPattern = /^Bearer (pcp_[a-f0-9]{64})$/;

export function createApiKeyAuthenticator(repository: ApiKeyRepository) {
  return async function authenticateApiKey(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const authorization = request.headers.authorization;
    if (authorization === undefined) {
      throw new ApiError(401, "missing_api_key", "A Bearer API key is required");
    }

    const match = bearerPattern.exec(authorization);
    if (!match?.[1]) {
      throw new ApiError(401, "invalid_api_key", "The API key is invalid");
    }

    const keyHash = createHash("sha256").update(match[1].slice(4)).digest("hex");
    const record = await repository.findByHash(keyHash);
    if (record === null) {
      throw new ApiError(401, "invalid_api_key", "The API key is invalid");
    }
    if (!record.isActive) {
      throw new ApiError(401, "api_key_inactive", "The API key is inactive");
    }
    if (record.expiresAt !== null && record.expiresAt.getTime() <= Date.now()) {
      throw new ApiError(401, "api_key_expired", "The API key has expired");
    }
    if (record.allowedIps.length > 0 && !record.allowedIps.includes(request.ip)) {
      throw new ApiError(403, "ip_not_allowed", "This IP address is not allowed");
    }

    request.apiPrincipal = {
      apiKeyId: record.id,
      apiKeyName: record.name,
      companyId: record.companyId,
      companyName: record.companyName,
      userId: record.userId,
      scopes: [...record.permissions]
    };
    await repository.markUsed(record.id);
  };
}
