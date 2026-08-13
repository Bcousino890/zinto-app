import type pg from "pg";

import type { WebhookSecretCipher } from "./cipher.js";

export interface ClaimedWebhookDelivery {
  id: string;
  eventId: string;
  eventType: string;
  attemptCount: number;
  occurredAt: string;
  payload: unknown;
  secret: string;
  url: string;
}

export interface WebhookDeliveryRepository {
  claimBatch(limit: number): Promise<ClaimedWebhookDelivery[]>;
  markDelivered(id: string): Promise<void>;
  markRetry(id: string, nextAttemptAt: Date, error: string): Promise<void>;
  markDead(id: string): Promise<void>;
}

interface DeliveryRow {
  id: string;
  event_id: string;
  event_type: string;
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
      // `occurred_at >= endpoints.created_at` is what makes registering a
      // webhook safe: an endpoint subscribes to what happens next, never to the
      // backlog. Without it, a partner connecting to a tenant that already has
      // history would be flooded with every past event on its first tick.
      await client.query(
        `INSERT INTO integration_api_webhook_deliveries (endpoint_id, outbox_id)
         SELECT endpoints.id, outbox.id
           FROM integration_api_outbox outbox
           JOIN integration_api_webhook_endpoints endpoints
             ON endpoints.company_id = outbox.company_id
            AND endpoints.active = TRUE
            AND outbox.occurred_at >= endpoints.created_at
            AND (cardinality(endpoints.event_types) = 0 OR outbox.event_type = ANY(endpoints.event_types))
          WHERE outbox.processed_at IS NULL
         ON CONFLICT (endpoint_id, outbox_id) DO NOTHING`
      );
      // The same time predicate has to appear here too. Without it, an event
      // older than every endpoint would look "interesting" to this check, never
      // get a delivery row, and stay unprocessed forever.
      await client.query(
        `UPDATE integration_api_outbox SET processed_at = NOW()
          WHERE processed_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM integration_api_webhook_endpoints endpoints
               WHERE endpoints.company_id = integration_api_outbox.company_id
                 AND endpoints.active = TRUE
                 AND integration_api_outbox.occurred_at >= endpoints.created_at
                 AND (cardinality(endpoints.event_types) = 0 OR integration_api_outbox.event_type = ANY(endpoints.event_types))
            )`
      );
      // Rows that did fan out were never being closed: processed_at was only
      // ever set for events nobody wanted, so any tenant with an active webhook
      // accumulated outbox rows that retention could not reach. Close them once
      // every delivery has reached a terminal state.
      await client.query(
        `UPDATE integration_api_outbox SET processed_at = NOW()
          WHERE processed_at IS NULL
            AND EXISTS (
              SELECT 1 FROM integration_api_webhook_deliveries deliveries
               WHERE deliveries.outbox_id = integration_api_outbox.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM integration_api_webhook_deliveries deliveries
               WHERE deliveries.outbox_id = integration_api_outbox.id
                 AND deliveries.status NOT IN ('delivered', 'dead')
            )`
      );
      const result = await client.query<DeliveryRow>(
        `WITH claimed AS (
           SELECT deliveries.id
             FROM integration_api_webhook_deliveries deliveries
            WHERE deliveries.status IN ('pending', 'retrying')
              AND deliveries.next_attempt_at <= NOW()
              AND (deliveries.lease_expires_at IS NULL OR deliveries.lease_expires_at < NOW())
            ORDER BY deliveries.id
            FOR UPDATE SKIP LOCKED
            LIMIT $1
         )
         UPDATE integration_api_webhook_deliveries deliveries
            SET status = 'leased', lease_expires_at = NOW() + INTERVAL '2 minutes',
                attempt_count = attempt_count + 1, updated_at = NOW()
           FROM claimed, integration_api_outbox outbox, integration_api_webhook_endpoints endpoints
          WHERE deliveries.id = claimed.id AND outbox.id = deliveries.outbox_id
            AND endpoints.id = deliveries.endpoint_id
         RETURNING deliveries.id, outbox.event_id, outbox.event_type, deliveries.attempt_count,
                   outbox.occurred_at, outbox.payload, endpoints.encrypted_secret, endpoints.url`,
        [limit]
      );
      await client.query("COMMIT");
      return result.rows.map((row) => ({
        id: String(row.id),
        eventId: String(row.event_id),
        eventType: row.event_type,
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

  async markDelivered(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE integration_api_webhook_deliveries
          SET status = 'delivered', delivered_at = NOW(), lease_expires_at = NULL, updated_at = NOW()
        WHERE id = $1`,
      [id]
    );
  }

  async markRetry(id: string, nextAttemptAt: Date, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE integration_api_webhook_deliveries
          SET status = 'retrying', next_attempt_at = $2, error_message = $3,
              lease_expires_at = NULL, updated_at = NOW()
        WHERE id = $1`,
      [id, nextAttemptAt, error.slice(0, 2000)]
    );
  }

  async markDead(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE integration_api_webhook_deliveries
          SET status = 'dead', lease_expires_at = NULL, updated_at = NOW()
        WHERE id = $1`,
      [id]
    );
  }
}
