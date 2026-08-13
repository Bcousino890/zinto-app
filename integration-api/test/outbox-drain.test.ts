import type pg from "pg";
import { describe, expect, it } from "vitest";

import { PostgresWebhookDeliveryRepository } from "../src/webhooks/deliveries.js";
import { WebhookSecretCipher } from "../src/webhooks/cipher.js";

/**
 * `claimBatch` runs four statements in one transaction and each one carries an
 * invariant that only shows up in production if it regresses:
 *
 *  - the fan-out must not hand a newly registered endpoint the tenant's
 *    backlog;
 *  - the "nobody wants this" close must use the same time predicate, or
 *    pre-registration events stay unprocessed forever and retention never
 *    reaches them;
 *  - rows that did fan out must be closed once every delivery is terminal,
 *    which is what stops the outbox growing without bound for any tenant with
 *    an active webhook.
 *
 * These were verified against a real PostgreSQL before being pinned here; this
 * suite exists so a refactor cannot quietly drop one of the predicates.
 */
class FakePool {
  statements: string[] = [];
  released = false;

  async connect() {
    return {
      query: async (text: string) => {
        this.statements.push(text);
        return { rows: [] };
      },
      release: () => { this.released = true; }
    };
  }
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

async function claim() {
  const pool = new FakePool();
  const repository = new PostgresWebhookDeliveryRepository(
    pool as unknown as pg.Pool,
    new WebhookSecretCipher("a".repeat(64))
  );
  await repository.claimBatch(50);
  return pool.statements.map(flat);
}

describe("outbox drain", () => {
  it("never fans out events that occurred before the endpoint was registered", async () => {
    const [, fanOut] = await claim();

    expect(fanOut).toContain("INSERT INTO integration_api_webhook_deliveries");
    expect(fanOut).toContain("outbox.occurred_at >= endpoints.created_at");
  });

  it("applies the same time predicate when closing events nobody subscribes to", async () => {
    const closeUnwanted = (await claim()).find((text) =>
      text.startsWith("UPDATE integration_api_outbox") && text.includes("NOT EXISTS") &&
      text.includes("integration_api_webhook_endpoints"));

    expect(closeUnwanted).toBeDefined();
    expect(closeUnwanted).toContain("integration_api_outbox.occurred_at >= endpoints.created_at");
  });

  it("closes an outbox row once every delivery reached a terminal state", async () => {
    const closeDelivered = (await claim()).find((text) =>
      text.startsWith("UPDATE integration_api_outbox") &&
      text.includes("integration_api_webhook_deliveries"));

    expect(closeDelivered).toBeDefined();
    expect(closeDelivered).toContain("SET processed_at = NOW()");
    expect(closeDelivered).toContain("status NOT IN ('delivered', 'dead')");
  });

  it("keeps every statement inside one transaction and releases the client", async () => {
    const pool = new FakePool();
    const repository = new PostgresWebhookDeliveryRepository(
      pool as unknown as pg.Pool,
      new WebhookSecretCipher("a".repeat(64))
    );

    await repository.claimBatch(50);

    expect(pool.statements[0]).toBe("BEGIN");
    expect(pool.statements.at(-1)).toBe("COMMIT");
    expect(pool.released).toBe(true);
  });
});
