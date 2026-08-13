import type { ClaimedWebhookDelivery, WebhookDeliveryRepository } from "./deliveries.js";
import { signWebhook } from "./signature.js";

const maxAttempts = 10;
const maxDelayMs = 24 * 60 * 60 * 1000;

export function calculateNextAttempt(now: Date, attemptCount: number, jitter: number): Date {
  const delay = Math.min(30_000 * 2 ** Math.max(0, attemptCount - 1), maxDelayMs);
  return new Date(now.getTime() + delay + Math.floor(delay * 0.2 * jitter));
}

type Fetcher = (request: Request) => Promise<Response>;

async function deliver(
  item: ClaimedWebhookDelivery,
  repository: WebhookDeliveryRepository,
  fetcher: Fetcher,
  now: Date,
  random: () => number
): Promise<void> {
  const body = JSON.stringify({
    id: item.eventId,
    type: item.eventType,
    schema_version: 1,
    occurred_at: item.occurredAt,
    data: item.payload
  });
  const timestamp = String(Math.floor(now.getTime() / 1000));
  try {
    const response = await fetcher(new Request(item.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-zinto-event-id": item.eventId,
        "x-zinto-timestamp": timestamp,
        "x-zinto-signature": signWebhook(timestamp, body, item.secret)
      },
      body,
      signal: AbortSignal.timeout(15_000)
    }));
    if (response.ok) {
      await repository.markDelivered(item.id);
      return;
    }
    throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    if (item.attemptCount >= maxAttempts) {
      await repository.markDead(item.id);
      return;
    }
    const message = error instanceof Error ? error.message : "Webhook delivery failed";
    await repository.markRetry(item.id, calculateNextAttempt(now, item.attemptCount, random()), message);
  }
}

export async function dispatchBatch(
  repository: WebhookDeliveryRepository,
  fetcher: Fetcher = fetch,
  now: Date = new Date(),
  random: () => number = Math.random
): Promise<number> {
  const deliveries = await repository.claimBatch(50);
  await Promise.all(deliveries.map((item) => deliver(item, repository, fetcher, now, random)));
  return deliveries.length;
}
