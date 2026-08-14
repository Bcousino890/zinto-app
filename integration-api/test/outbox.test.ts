import { describe, expect, it } from "vitest";

import { calculateNextAttempt, dispatchBatch } from "../src/webhooks/dispatcher.js";
import type {
  ClaimedWebhookDelivery,
  WebhookDeliveryRepository
} from "../src/webhooks/deliveries.js";
import { PostgresWebhookDeliveryRepository } from "../src/webhooks/deliveries.js";

class MemoryDeliveries implements WebhookDeliveryRepository {
  deliveries: ClaimedWebhookDelivery[] = [];
  delivered: string[] = [];
  retried: Array<{ id: string; nextAttemptAt: Date; error: string }> = [];
  dead: string[] = [];

  async claimBatch(limit: number) { return this.deliveries.splice(0, limit); }
  async markDelivered(id: string, leaseToken: string) { this.delivered.push(`${id}:${leaseToken}`); }
  async markRetry(id: string, leaseToken: string, nextAttemptAt: Date, error: string) {
    this.retried.push({ id, nextAttemptAt, error });
  }
  async markDead(id: string, leaseToken: string) { this.dead.push(`${id}:${leaseToken}`); }
}

describe("webhook delivery dispatcher", () => {
  it("uses bounded exponential backoff", () => {
    const now = new Date("2026-08-13T14:00:00.000Z");
    expect(calculateNextAttempt(now, 1, 0).toISOString()).toBe("2026-08-13T14:00:30.000Z");
    expect(calculateNextAttempt(now, 4, 0).toISOString()).toBe("2026-08-13T14:04:00.000Z");
    expect(calculateNextAttempt(now, 20, 0).toISOString()).toBe("2026-08-14T14:00:00.000Z");
  });

  it("signs and acknowledges a successful delivery", async () => {
    const repository = new MemoryDeliveries();
    repository.deliveries.push({
      id: "1",
      leaseToken: "lease-1",
      eventId: "evt_1",
      eventType: "message.created",
      schemaVersion: 3,
      attemptCount: 0,
      occurredAt: "2026-08-13T14:00:00.000Z",
      payload: { id: "701", content: "Hola" },
      secret: "whsec_test",
      url: "https://smartbc.example/webhook"
    });
    const requests: Request[] = [];

    await dispatchBatch(repository, async (request) => {
      requests.push(request);
      return new Response(null, { status: 204 });
    }, new Date("2026-08-13T14:01:00.000Z"), () => 0);

    expect(repository.delivered).toEqual(["1:lease-1"]);
    expect(requests[0]!.headers.get("content-type")).toBe("application/json");
    expect(requests[0]!.headers.get("x-zinto-event-id")).toBe("evt_1");
    expect(requests[0]!.headers.get("x-zinto-timestamp")).toBe("1786629660");
    expect(requests[0]!.headers.get("x-zinto-signature"))
      .toBe("v1=868f9fce95534bc8e9bbc81854bfeda5a665cf426ffc7f9e803afbd5015da365");
    await expect(requests[0]!.json()).resolves.toEqual({
      id: "evt_1",
      type: "message.created",
      schema_version: 3,
      occurred_at: "2026-08-13T14:00:00.000Z",
      data: { id: "701", content: "Hola" }
    });
  });

  it("retries transient failures and dead-letters the final attempt", async () => {
    const repository = new MemoryDeliveries();
    const base = {
      eventId: "evt_1",
      eventType: "message.created",
      schemaVersion: 1,
      occurredAt: "2026-08-13T14:00:00.000Z",
      payload: { id: "701" },
      secret: "whsec_test",
      url: "https://smartbc.example/webhook"
    };
    repository.deliveries.push(
      { ...base, id: "1", leaseToken: "lease-1", attemptCount: 2 },
      { ...base, id: "2", leaseToken: "lease-2", attemptCount: 10 }
    );

    await dispatchBatch(
      repository,
      async () => new Response("unavailable", { status: 503 }),
      new Date("2026-08-13T14:01:00.000Z"),
      () => 0
    );

    expect(repository.retried.map((item) => item.id)).toEqual(["1"]);
    expect(repository.dead).toEqual(["2:lease-2"]);
  });

  it("keeps the same event ID and schema version when a delivery is retried", async () => {
    const repository = new MemoryDeliveries();
    const delivery: ClaimedWebhookDelivery = {
      id: "7",
      leaseToken: "lease-7",
      eventId: "c28be6be-2771-4e76-9dbe-8cc78669b588",
      eventType: "deal.stage.changed",
      schemaVersion: 2,
      attemptCount: 2,
      occurredAt: "2026-08-13T14:00:00.000Z",
      payload: { id: "44", previous_stage_id: "2", stage_id: "3" },
      secret: "whsec_test",
      url: "https://smartbc.example/webhook"
    };
    const seen: Array<{ eventId: string | null; body: unknown }> = [];

    for (const status of [503, 204]) {
      repository.deliveries.push(delivery);
      await dispatchBatch(repository, async (request) => {
        seen.push({
          eventId: request.headers.get("x-zinto-event-id"),
          body: await request.json()
        });
        return new Response(null, { status });
      }, new Date("2026-08-13T14:01:00.000Z"), () => 0);
    }

    expect(seen).toEqual([
      { eventId: delivery.eventId, body: expect.objectContaining({ id: delivery.eventId, schema_version: 2 }) },
      { eventId: delivery.eventId, body: expect.objectContaining({ id: delivery.eventId, schema_version: 2 }) }
    ]);
  });
});

describe("Postgres webhook leasing", () => {
  it("fans out tenant-matched rows once and reclaims only expired leases", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("RETURNING deliveries.id")) {
          return {
            rows: [{
              id: "9",
              lease_token: "2fe90c1f-2200-46a9-966c-56d6ee65a5dd",
              event_id: "75ba1f91-172f-4a34-b5fe-cf81be9bc7b8",
              event_type: "task.completed",
              schema_version: 4,
              attempt_count: 3,
              occurred_at: new Date("2026-08-13T14:00:00.000Z"),
              payload: { id: "81" },
              encrypted_secret: "encrypted",
              url: "https://smartbc.example/webhook"
            }]
          };
        }
        return { rows: [] };
      },
      release() {}
    };
    const pool = {
      async connect() { return client; },
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [], rowCount: 1 };
      }
    };
    const cipher = { decrypt: () => "whsec_test" };
    const repository = new PostgresWebhookDeliveryRepository(pool as never, cipher as never);

    const claimed = await repository.claimBatch(50);

    expect(claimed[0]).toEqual(expect.objectContaining({
      eventType: "task.completed",
      leaseToken: "2fe90c1f-2200-46a9-966c-56d6ee65a5dd",
      schemaVersion: 4,
      attemptCount: 3
    }));
    const fanoutSql = queries.find(({ text }) => text.includes("integration_api_webhook_deliveries"))!.text;
    expect(fanoutSql).toContain("endpoints.company_id = outbox.company_id");
    expect(fanoutSql).toContain("ON CONFLICT (endpoint_id, outbox_id) DO NOTHING");
    expect(fanoutSql).toContain("processed_at = NOW()");
    const claimSql = queries.find(({ text }) => text.includes("RETURNING deliveries.id"))!.text;
    expect(claimSql).toContain("deliveries.status = 'leased'");
    expect(claimSql).toContain("deliveries.lease_expires_at < NOW()");
    expect(claimSql).toContain("endpoints.active = TRUE");

    await repository.markDelivered("9", claimed[0]!.leaseToken);
    await repository.markRetry("9", claimed[0]!.leaseToken, new Date(), "failed");
    await repository.markDead("9", claimed[0]!.leaseToken);
    const completionSql = queries.slice(-3);
    expect(completionSql.every(({ text, values }) =>
      /lease_token = \$\d/.test(text) && text.includes("status = 'leased'") && values?.includes(claimed[0]!.leaseToken)
    )).toBe(true);
  });
});
