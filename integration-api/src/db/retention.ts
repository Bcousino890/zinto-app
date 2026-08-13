import type pg from "pg";

/**
 * Housekeeping for the integration API's own bookkeeping tables. None of
 * this touches business data (contacts, conversations, deals, ...) - only
 * the plumbing tables this service created for idempotency, the outbox and
 * webhook delivery tracking (see migrations/001_integration_api.sql).
 */
export interface RetentionRepository {
  /** Deletes idempotency records whose grace period (past expires_at) has elapsed. */
  purgeExpiredIdempotency(before: Date): Promise<number>;
  /** Deletes outbox events that were fully processed before `before`. */
  purgeProcessedOutbox(before: Date): Promise<number>;
  /** Deletes webhook delivery attempts that reached a terminal state before `before`. */
  purgeTerminalWebhookDeliveries(before: Date): Promise<number>;
}

/**
 * A single unbounded DELETE can, on a table that was left to grow for a long
 * time (the purge job was disabled, crash-looping, or simply didn't exist
 * yet, which is exactly our starting point), hold row locks and generate a
 * lot of WAL in one transaction. None of these tables carry meaningful
 * volume today - they are new, and empty in production - so this is a
 * defensive measure rather than a response to an observed problem: batching
 * costs one extra subquery and nothing else. If a backlog ever does appear
 * it drains over a handful of ticks (see startRetentionPurge below) instead
 * of in one long-running transaction. A backlog that doesn't drain within a
 * few thousand ticks means the purge job stopped running for a long time,
 * which is a bigger problem than the batch size.
 */
const PURGE_BATCH_LIMIT = 5_000;

export class PostgresRetentionRepository implements RetentionRepository {
  constructor(private readonly pool: pg.Pool) {}

  async purgeExpiredIdempotency(before: Date): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM integration_api_idempotency
        WHERE id IN (
          SELECT id FROM integration_api_idempotency
           WHERE expires_at < $1
           ORDER BY id
           LIMIT $2
        )`,
      [before, PURGE_BATCH_LIMIT]
    );
    return result.rowCount ?? 0;
  }

  async purgeProcessedOutbox(before: Date): Promise<number> {
    // integration_api_webhook_deliveries.outbox_id references this table
    // ON DELETE CASCADE (migrations/001_integration_api.sql), so deleting an
    // outbox row deletes any delivery rows still pointing at it. This method
    // is called *after* purgeTerminalWebhookDeliveries by startRetentionPurge
    // precisely so delivery rows are always removed by their own
    // status + updated_at rule and their own configured retention window,
    // never incidentally by this cascade - see the comment on
    // startRetentionPurge for the full reasoning.
    const result = await this.pool.query(
      `DELETE FROM integration_api_outbox
        WHERE id IN (
          SELECT id FROM integration_api_outbox
           WHERE processed_at IS NOT NULL AND processed_at < $1
           ORDER BY id
           LIMIT $2
        )`,
      [before, PURGE_BATCH_LIMIT]
    );
    return result.rowCount ?? 0;
  }

  async purgeTerminalWebhookDeliveries(before: Date): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM integration_api_webhook_deliveries
        WHERE id IN (
          SELECT id FROM integration_api_webhook_deliveries
           WHERE status IN ('delivered', 'dead') AND updated_at < $1
           ORDER BY id
           LIMIT $2
        )`,
      [before, PURGE_BATCH_LIMIT]
    );
    return result.rowCount ?? 0;
  }
}

export interface RetentionWindows {
  /** Grace period added on top of each row's own expires_at before it is deleted. */
  idempotencyGraceMs: number;
  outboxRetentionMs: number;
  webhookDeliveryRetentionMs: number;
}

type RetentionScope = "idempotency" | "webhook_deliveries" | "outbox";

/**
 * Runs the three purges on a fixed interval, one after another, each
 * wrapped so a failure in one does not stop the others or crash the process
 * - the same "log it and keep going" spirit as FilesystemMediaStore.purge
 * (src/media/store.ts).
 *
 * Order matters for one reason: integration_api_webhook_deliveries.outbox_id
 * has ON DELETE CASCADE onto integration_api_outbox. Purging deliveries
 * first means every delivery row is removed by its own explicit
 * status + updated_at rule (and its own configured retention window), and an
 * outbox delete can never cascade away a delivery row before that row
 * qualifies on its own terms. This ordering is load-bearing now: claimBatch
 * also closes outbox rows once all their deliveries reach a terminal state, so
 * a purgeable outbox row routinely does have delivery children, and the
 * cascade would fire if the order were reversed.
 */
export function startRetentionPurge(
  repository: RetentionRepository,
  windows: RetentionWindows,
  intervalMs = 60_000,
  onError: (scope: RetentionScope, error: unknown) => void = () => undefined,
  now: () => Date = () => new Date()
): () => void {
  const run = async (scope: RetentionScope, purge: () => Promise<number>): Promise<void> => {
    try {
      await purge();
    } catch (error) {
      onError(scope, error);
    }
  };

  const tick = async (): Promise<void> => {
    const nowMs = now().getTime();
    await run("idempotency", () =>
      repository.purgeExpiredIdempotency(new Date(nowMs - windows.idempotencyGraceMs)));
    await run("webhook_deliveries", () =>
      repository.purgeTerminalWebhookDeliveries(new Date(nowMs - windows.webhookDeliveryRetentionMs)));
    await run("outbox", () =>
      repository.purgeProcessedOutbox(new Date(nowMs - windows.outboxRetentionMs)));
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
