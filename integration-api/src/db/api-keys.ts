import type pg from "pg";

import type { ApiKeyRecord, ApiKeyRepository } from "../auth/api-key.js";

interface ApiKeyRow {
  id: number;
  company_id: number;
  company_name: string;
  user_id: number;
  name: string;
  key_hash: string;
  permissions: unknown;
  is_active: boolean;
  expires_at: Date | null;
  allowed_ips: unknown;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export class PostgresApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly pool: pg.Pool) {}

  async findByHash(hash: string): Promise<ApiKeyRecord | null> {
    const result = await this.pool.query<ApiKeyRow>(
      `SELECT api_keys.id,
              api_keys.company_id,
              companies.name AS company_name,
              api_keys.user_id,
              api_keys.name,
              api_keys.key_hash,
              api_keys.permissions,
              api_keys.is_active,
              api_keys.expires_at,
              api_keys.allowed_ips
         FROM api_keys
         JOIN companies ON companies.id = api_keys.company_id
        WHERE api_keys.key_hash = $1
        LIMIT 1`,
      [hash]
    );
    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }

    return {
      id: row.id,
      companyId: row.company_id,
      companyName: row.company_name,
      userId: row.user_id,
      name: row.name,
      keyHash: row.key_hash,
      permissions: stringArray(row.permissions),
      isActive: row.is_active,
      expiresAt: row.expires_at,
      allowedIps: stringArray(row.allowed_ips)
    };
  }

  async markUsed(apiKeyId: number): Promise<void> {
    await this.pool.query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [apiKeyId]);
  }
}
