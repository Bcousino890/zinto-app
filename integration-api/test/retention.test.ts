import type pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PostgresRetentionRepository,
  startRetentionPurge,
  type RetentionRepository
} from "../src/db/retention.js";

interface Call {
  text: string;
  params: unknown[];
}

class FakePool {
  calls: Call[] = [];

  constructor(private readonly rowCount: number = 0) {}

  async query(text: string, params: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
    this.calls.push({ text, params });
    return { rows: [], rowCount: this.rowCount };
  }
}

function repository(rowCount = 0) {
  const pool = new FakePool(rowCount);
  return { pool, repository: new PostgresRetentionRepository(pool as unknown as pg.Pool) };
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

describe("PostgresRetentionRepository", () => {
  it("purges expired idempotency rows in batches bounded by a LIMIT", async () => {
    const { pool, repository: retention } = repository(3);
    const before = new Date("2026-08-10T00:00:00.000Z");

    const removed = await retention.purgeExpiredIdempotency(before);

    expect(pool.calls).toHaveLength(1);
    expect(flat(pool.calls[0]!.text)).toBe(
      "DELETE FROM integration_api_idempotency WHERE id IN ( SELECT id FROM integration_api_idempotency WHERE expires_at < $1 ORDER BY id LIMIT $2 )"
    );
    expect(pool.calls[0]!.params).toEqual([before, 5_000]);
    expect(removed).toBe(3);
  });

  it("purges processed outbox rows older than the cutoff, batched the same way", async () => {
    const { pool, repository: retention } = repository(7);
    const before = new Date("2026-08-06T00:00:00.000Z");

    const removed = await retention.purgeProcessedOutbox(before);

    expect(pool.calls).toHaveLength(1);
    expect(flat(pool.calls[0]!.text)).toBe(
      "DELETE FROM integration_api_outbox WHERE id IN ( SELECT id FROM integration_api_outbox WHERE processed_at IS NOT NULL AND processed_at < $1 ORDER BY id LIMIT $2 )"
    );
    expect(pool.calls[0]!.params).toEqual([before, 5_000]);
    expect(removed).toBe(7);
  });

  it("purges only terminal (delivered/dead) webhook deliveries older than the cutoff", async () => {
    const { pool, repository: retention } = repository(2);
    const before = new Date("2026-07-14T00:00:00.000Z");

    const removed = await retention.purgeTerminalWebhookDeliveries(before);

    expect(pool.calls).toHaveLength(1);
    expect(flat(pool.calls[0]!.text)).toBe(
      "DELETE FROM integration_api_webhook_deliveries WHERE id IN ( SELECT id FROM integration_api_webhook_deliveries WHERE status IN ('delivered', 'dead') AND updated_at < $1 ORDER BY id LIMIT $2 )"
    );
    expect(pool.calls[0]!.params).toEqual([before, 5_000]);
    expect(removed).toBe(2);
  });

  it("treats a null rowCount (as pg can return) as zero rows removed", async () => {
    const pool = {
      calls: [] as Call[],
      async query(text: string, params: unknown[]) {
        this.calls.push({ text, params });
        return { rows: [], rowCount: null };
      }
    };
    const retention = new PostgresRetentionRepository(pool as unknown as pg.Pool);

    expect(await retention.purgeExpiredIdempotency(new Date())).toBe(0);
  });
});

class RecordingRepository implements RetentionRepository {
  calls: Array<{ scope: string; before: Date }> = [];
  failScopes = new Set<string>();

  async purgeExpiredIdempotency(before: Date): Promise<number> {
    this.calls.push({ scope: "idempotency", before });
    if (this.failScopes.has("idempotency")) throw new Error("idempotency purge failed");
    return 0;
  }

  async purgeProcessedOutbox(before: Date): Promise<number> {
    this.calls.push({ scope: "outbox", before });
    if (this.failScopes.has("outbox")) throw new Error("outbox purge failed");
    return 0;
  }

  async purgeTerminalWebhookDeliveries(before: Date): Promise<number> {
    this.calls.push({ scope: "webhook_deliveries", before });
    if (this.failScopes.has("webhook_deliveries")) throw new Error("delivery purge failed");
    return 0;
  }
}

const windows = {
  idempotencyGraceMs: 24 * 60 * 60_000,
  outboxRetentionMs: 7 * 24 * 60 * 60_000,
  webhookDeliveryRetentionMs: 30 * 24 * 60 * 60_000
};

describe("startRetentionPurge scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not run before the first interval elapses", () => {
    const repo = new RecordingRepository();
    const stop = startRetentionPurge(repo, windows);

    expect(repo.calls).toHaveLength(0);
    stop();
  });

  it("runs all three purges once per 60s tick, in webhook_deliveries -> outbox order, with idempotency first", async () => {
    const repo = new RecordingRepository();
    const stop = startRetentionPurge(repo, windows);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(repo.calls.map((call) => call.scope)).toEqual(["idempotency", "webhook_deliveries", "outbox"]);
    stop();
  });

  it("computes each cutoff from its own configured retention window relative to now", async () => {
    const repo = new RecordingRepository();
    const stop = startRetentionPurge(repo, windows);

    await vi.advanceTimersByTimeAsync(60_000);

    // The tick fires once the 60s interval elapses, so "now" inside it is
    // 12:01:00, not the 12:00:00 the fake clock started at.
    const byScope = Object.fromEntries(repo.calls.map((call) => [call.scope, call.before]));
    expect((byScope.idempotency as Date).toISOString()).toBe("2026-08-12T12:01:00.000Z");
    expect((byScope.outbox as Date).toISOString()).toBe("2026-08-06T12:01:00.000Z");
    expect((byScope.webhook_deliveries as Date).toISOString()).toBe("2026-07-14T12:01:00.000Z");
    stop();
  });

  it("fires again on each subsequent tick and stops firing once stopped", async () => {
    const repo = new RecordingRepository();
    const stop = startRetentionPurge(repo, windows);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(repo.calls).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(repo.calls).toHaveLength(6);

    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(repo.calls).toHaveLength(6);
  });

  it("respects a custom interval", async () => {
    const repo = new RecordingRepository();
    const stop = startRetentionPurge(repo, windows, 5_000);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(repo.calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(repo.calls).toHaveLength(3);

    stop();
  });

  it("keeps running the other purges when one of them throws, and reports the failure", async () => {
    const repo = new RecordingRepository();
    repo.failScopes.add("idempotency");
    const errors: Array<{ scope: string; error: unknown }> = [];
    const stop = startRetentionPurge(repo, windows, 60_000, (scope, error) => errors.push({ scope, error }));

    await vi.advanceTimersByTimeAsync(60_000);

    expect(repo.calls.map((call) => call.scope)).toEqual(["idempotency", "webhook_deliveries", "outbox"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.scope).toBe("idempotency");
    expect((errors[0]!.error as Error).message).toBe("idempotency purge failed");
    stop();
  });

  it("does not let a failure in the middle purge stop the last one", async () => {
    const repo = new RecordingRepository();
    repo.failScopes.add("webhook_deliveries");
    const errors: string[] = [];
    const stop = startRetentionPurge(repo, windows, 60_000, (scope) => errors.push(scope));

    await vi.advanceTimersByTimeAsync(60_000);

    expect(repo.calls.map((call) => call.scope)).toEqual(["idempotency", "webhook_deliveries", "outbox"]);
    expect(errors).toEqual(["webhook_deliveries"]);
    stop();
  });

  it("does not crash the process when every purge fails", async () => {
    const repo = new RecordingRepository();
    repo.failScopes.add("idempotency");
    repo.failScopes.add("webhook_deliveries");
    repo.failScopes.add("outbox");
    const errors: string[] = [];
    const stop = startRetentionPurge(repo, windows, 60_000, (scope) => errors.push(scope));

    await vi.advanceTimersByTimeAsync(60_000);

    expect(errors).toEqual(["idempotency", "webhook_deliveries", "outbox"]);
    stop();
  });
});
