import { describe, expect, it } from "vitest";

import { calculateNextAttempt, dispatchBatch } from "../src/webhooks/dispatcher.js";
import type {
  ClaimedWebhookDelivery,
  WebhookDeliveryRepository
} from "../src/webhooks/deliveries.js";

class MemoryDeliveries implements WebhookDeliveryRepository {
  deliveries: ClaimedWebhookDelivery[] = [];
  delivered: string[] = [];
  retried: Array<{ id: string; nextAttemptAt: Date; error: string }> = [];
  dead: string[] = [];

  async claimBatch(limit: number) { return this.deliveries.splice(0, limit); }
  async markDelivered(id: string) { this.delivered.push(id); }
  async markRetry(id: string, nextAttemptAt: Date, error: string) {
    this.retried.push({ id, nextAttemptAt, error });
  }
  async markDead(id: string) { this.dead.push(id); }
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
      eventId: "evt_1",
      eventType: "message.created",
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

    expect(repository.delivered).toEqual(["1"]);
    expect(requests[0]!.headers.get("x-zinto-event-id")).toBe("evt_1");
    expect(requests[0]!.headers.get("x-zinto-signature")).toMatch(/^v1=[a-f0-9]{64}$/);
  });

  it("retries transient failures and dead-letters the final attempt", async () => {
    const repository = new MemoryDeliveries();
    const base = {
      eventId: "evt_1",
      eventType: "message.created",
      occurredAt: "2026-08-13T14:00:00.000Z",
      payload: { id: "701" },
      secret: "whsec_test",
      url: "https://smartbc.example/webhook"
    };
    repository.deliveries.push(
      { ...base, id: "1", attemptCount: 2 },
      { ...base, id: "2", attemptCount: 10 }
    );

    await dispatchBatch(
      repository,
      async () => new Response("unavailable", { status: 503 }),
      new Date("2026-08-13T14:01:00.000Z"),
      () => 0
    );

    expect(repository.retried.map((item) => item.id)).toEqual(["1"]);
    expect(repository.dead).toEqual(["2"]);
  });
});
