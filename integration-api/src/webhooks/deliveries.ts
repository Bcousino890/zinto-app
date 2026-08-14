import type pg from "pg";

import type { WebhookSecretCipher } from "./cipher.js";

export interface ClaimedWebhookDelivery {
  id: string;
  leaseToken: string;
  eventId: string;
  eventType: string;
  schemaVersion: number;
  attemptCount: number;
  occurredAt: string;
  payload: unknown;
  secret: string;
  url: string;
}

export interface WebhookDeliveryRepository {
  claimBatch(limit: number): Promise<ClaimedWebhookDelivery[]>;
  markDelivered(id: string, leaseToken: string): Promise<void>;
  markRetry(id: string, leaseToken: string, nextAttemptAt: Date, error: string): Promise<void>;
  markDead(id: string, leaseToken: string): Promise<void>;
}

interface DeliveryRow {
  id: string;
  lease_token: string;
  event_id: string;
  event_type: string;
  schema_version: number;
  attempt_count: number;
  occurred_at: Date;
  payload: unknown;
  encrypted_secret: string;
  url: string;
}

export class PostgresWebhookDeliveryRepository implements WebhookDeliveryRepository {
  constructor(private readonly pool: pg.Pool, private readonly cipher: WebhookSecretCipher) {}

  async claimBatch(limit: number): Promise<ClaimedWebhookDelivery[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `WITH candidates AS (
           SELECT outbox.id
             FROM integration_api_outbox outbox
            WHERE outbox.processed_at IS NULL
              AND outbox.available_at <= NOW()
            ORDER BY outbox.id
            FOR UPDATE SKIP LOCKED
            LIMIT $1
         ), fanout AS (
           INSERT INTO integration_api_webhook_deliveries (endpoint_id, outbox_id)
           SELECT endpoints.id, outbox.id
             FROM candidates
             JOIN integration_api_outbox outbox ON outbox.id = candidates.id
             JOIN integration_api_webhook_endpoints endpoints
               ON endpoints.company_id = outbox.company_id
              AND endpoints.active = TRUE
              AND (cardinality(endpoints.event_types) = 0 OR outbox.event_type = ANY(endpoints.event_types))
           ON CONFLICT (endpoint_id, outbox_id) DO NOTHING
           RETURNING outbox_id
         )
         UPDATE integration_api_outbox outbox
            SET processed_at = NOW()
          WHERE outbox.id IN (SELECT id FROM candidates)`,
        [Math.max(limit * 10, 100)]
      );
      await client.query(
        `UPDATE integration_api_webhook_deliveries deliveries
            SET status = 'dead', lease_expires_at = NULL, lease_token = NULL, updated_at = NOW(),
                error_message = 'Webhook endpoint disabled'
           FROM integration_api_webhook_endpoints endpoints
          WHERE endpoints.id = deliveries.endpoint_id
            AND endpoints.active = FALSE
            AND deliveries.status IN ('pending', 'retrying', 'leased')`
      );
      const result = await client.query<DeliveryRow>(
        `WITH claimed AS (
           SELECT deliveries.id
             FROM integration_api_webhook_deliveries deliveries
            WHERE (
                (deliveries.status IN ('pending', 'retrying') AND deliveries.next_attempt_at <= NOW())
                OR (deliveries.status = 'leased' AND deliveries.lease_expires_at < NOW())
              )
            ORDER BY deliveries.id
            FOR UPDATE SKIP LOCKED
            LIMIT $1
         )
         UPDATE integration_api_webhook_deliveries deliveries
            SET status = 'leased', lease_token = gen_random_uuid(),
                lease_expires_at = NOW() + INTERVAL '2 minutes',
                attempt_count = attempt_count + 1, updated_at = NOW()
           FROM claimed, integration_api_outbox outbox, integration_api_webhook_endpoints endpoints
          WHERE deliveries.id = claimed.id AND outbox.id = deliveries.outbox_id
            AND endpoints.id = deliveries.endpoint_id
            AND endpoints.active = TRUE
         RETURNING deliveries.id, deliveries.lease_token, outbox.event_id, outbox.event_type,
                   outbox.schema_version,
                   deliveries.attempt_count,
                   outbox.occurred_at, outbox.payload, endpoints.encrypted_secret, endpoints.url`,
        [limit]
      );
      await client.query("COMMIT");
      return result.rows.map((row) => ({
        id: String(row.id),
        leaseToken: String(row.lease_token),
        eventId: String(row.event_id),
        eventType: row.event_type,
        schemaVersion: row.schema_version,
        attemptCount: row.attempt_count,
        occurredAt: row.occurred_at.toISOString(),
        payload: row.payload,
        secret: this.cipher.decrypt(row.encrypted_secret),
        url: row.url
      }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markDelivered(id: string, leaseToken: string): Promise<void> {
    await this.pool.query(
      `UPDATE integration_api_webhook_deliveries
          SET status = 'delivered', delivered_at = NOW(), lease_expires_at = NULL,
              lease_token = NULL, updated_at = NOW()
        WHERE id = $1 AND lease_token = $2 AND status = 'leased'`,
      [id, leaseToken]
    );
  }

  async markRetry(id: string, leaseToken: string, nextAttemptAt: Date, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE integration_api_webhook_deliveries
          SET status = 'retrying', next_attempt_at = $2, error_message = $3,
              lease_expires_at = NULL, lease_token = NULL, updated_at = NOW()
        WHERE id = $1 AND lease_token = $4 AND status = 'leased'`,
      [id, nextAttemptAt, error.slice(0, 2000), leaseToken]
    );
  }

  async markDead(id: string, leaseToken: string): Promise<void> {
    await this.pool.query(
      `UPDATE integration_api_webhook_deliveries
          SET status = 'dead', lease_expires_at = NULL, lease_token = NULL, updated_at = NOW()
        WHERE id = $1 AND lease_token = $2 AND status = 'leased'`,
      [id, leaseToken]
    );
  }
}
