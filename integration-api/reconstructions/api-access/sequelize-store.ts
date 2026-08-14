import type { ApiKeyRecord, ApiKeyRecordInput, ApiKeyStore } from "./backend.js";

export interface LegacyApiKeyModel {
  create(values: Record<string, unknown>): Promise<Record<string, unknown>>;
}

function numberValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`invalid ${field} returned by api key model`);
  return value;
}

export function createSequelizeApiKeyStore(model: LegacyApiKeyModel): ApiKeyStore {
  return {
    async create(input: ApiKeyRecordInput): Promise<ApiKeyRecord> {
      const row = await model.create({
        companyId: input.companyId,
        userId: input.userId,
        name: input.name,
        keyHash: input.keyHash,
        keyPrefix: input.keyPrefix,
        permissions: [...input.permissions],
        metadata: input.metadata,
        isActive: true
      });
      return {
        id: numberValue(row.id, "id"),
        companyId: numberValue(row.companyId, "companyId"),
        userId: numberValue(row.userId, "userId"),
        name: String(row.name),
        keyPrefix: String(row.keyPrefix),
        permissions: Array.isArray(row.permissions) ? row.permissions as ApiKeyRecord["permissions"] : []
      };
    }
  };
}
