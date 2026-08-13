import { createHash } from "node:crypto";

import type pg from "pg";

import type { WebhookSecretCipher } from "./cipher.js";

export interface CreateWebhookInput {
  url: string;
  eventTypes: string[];
  secret: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  event_types: string[];
  active: boolean;
  created_at: string;
}

export interface WebhookRepository {
  create(companyId: number, apiKeyId: number, input: CreateWebhookInput): Promise<WebhookEndpoint>;
  list(companyId: number): Promise<WebhookEndpoint[]>;
  disable(companyId: number, endpointId: number): Promise<boolean>;
}

interface EndpointRow {
  id: string;
  url: string;
  event_types: string[];
  active: boolean;
  created_at: Date;
}

function endpoint(row: EndpointRow): WebhookEndpoint {
  return {
    id: String(row.id),
    url: row.url,
    event_types: row.event_types,
    active: row.active,
    created_at: row.created_at.toISOString()
  };
}

export class PostgresWebhookRepository implements WebhookRepository {
  constructor(private readonly pool: pg.Pool, private readonly cipher: WebhookSecretCipher) {}

  async create(companyId: number, apiKeyId: number, input: CreateWebhookInput) {
    const result = await this.pool.query<EndpointRow>(
      `INSERT INTO integration_api_webhook_endpoints
         (company_id, api_key_id, url, secret_hash, encrypted_secret, event_types)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, url, event_types, active, created_at`,
      [
        companyId,
        apiKeyId,
        input.url,
        createHash("sha256").update(input.secret).digest("hex"),
        this.cipher.encrypt(input.secret),
        input.eventTypes
      ]
    );
    return endpoint(result.rows[0]!);
  }

  async list(companyId: number) {
    const result = await this.pool.query<EndpointRow>(
      `SELECT id, url, event_types, active, created_at
         FROM integration_api_webhook_endpoints
        WHERE company_id = $1
        ORDER BY id DESC`,
      [companyId]
    );
    return result.rows.map(endpoint);
  }

  async disable(companyId: number, endpointId: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE integration_api_webhook_endpoints SET active = FALSE, updated_at = NOW()
        WHERE id = $1 AND company_id = $2`,
      [endpointId, companyId]
    );
    return (result.rowCount ?? 0) > 0;
  }
}
