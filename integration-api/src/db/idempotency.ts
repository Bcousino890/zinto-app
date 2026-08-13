import type pg from "pg";

import type {
  IdempotencyRecord,
  IdempotencyRepository,
  IdempotencyScope
} from "../http/idempotency.js";

interface IdempotencyRow {
  request_hash: string;
  response_status: number;
  response_body: unknown;
}

export class PostgresIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly pool: pg.Pool) {}

  async find(scope: IdempotencyScope): Promise<IdempotencyRecord | null> {
    const result = await this.pool.query<IdempotencyRow>(
      `SELECT request_hash, response_status, response_body
         FROM integration_api_idempotency
        WHERE api_key_id = $1 AND method = $2 AND path = $3 AND idempotency_key = $4
          AND expires_at > NOW()`,
      [scope.apiKeyId, scope.method, scope.path, scope.key]
    );
    const row = result.rows[0];
    return row === undefined ? null : {
      requestHash: row.request_hash,
      statusCode: row.response_status,
      responseBody: row.response_body
    };
  }

  async save(scope: IdempotencyScope, record: IdempotencyRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO integration_api_idempotency
         (api_key_id, method, path, idempotency_key, request_hash, response_status, response_body)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (api_key_id, method, path, idempotency_key) DO NOTHING`,
      [
        scope.apiKeyId,
        scope.method,
        scope.path,
        scope.key,
        record.requestHash,
        record.statusCode,
        JSON.stringify(record.responseBody)
      ]
    );
  }

  async runExclusive<T>(scope: IdempotencyScope, operation: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const lockKey = `${scope.apiKeyId}:${scope.method}:${scope.path}:${scope.key}`;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
      const result = await operation();
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
