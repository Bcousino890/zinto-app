import type pg from "pg";
import { describe, expect, it } from "vitest";

import { PostgresDeliveryAuditRepository } from "../src/resources/delivery-audit.js";

interface Call {
  text: string;
  params: unknown[];
}

class FakePool {
  calls: Call[] = [];

  async query(text: string, params: unknown[]): Promise<{ rows: unknown[] }> {
    this.calls.push({ text, params });
    return { rows: [] };
  }
}

function repository() {
  const pool = new FakePool();
  return { pool, repository: new PostgresDeliveryAuditRepository(pool as unknown as pg.Pool) };
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

describe("delivery audit repository", () => {
  it("inserts one audit record with the real actor and a numeric resource id", async () => {
    const { pool, repository: audit } = repository();

    await audit.record({
      companyId: 12,
      actorUserId: 4,
      action: "message.sent",
      resourceType: "message",
      resourceId: "901",
      payload: { to: "+34606806103", kind: "text" }
    });

    expect(pool.calls).toHaveLength(1);
    expect(flat(pool.calls[0]!.text)).toBe(
      "INSERT INTO integration_api_audit_records (company_id, actor_user_id, action, resource_type, resource_id, new_values) VALUES ($1, $2, $3, $4, $5, $6::jsonb)"
    );
    expect(pool.calls[0]!.params).toEqual([
      12,
      4,
      "message.sent",
      "message",
      901,
      JSON.stringify({ to: "+34606806103", kind: "text" })
    ]);
  });

  it("stores a null resource id rather than failing when the legacy id is not numeric", async () => {
    const { pool, repository: audit } = repository();

    await audit.record({
      companyId: 12,
      actorUserId: 4,
      action: "message.sent",
      resourceType: "message",
      resourceId: "wamid.not-numeric",
      payload: {}
    });

    expect(pool.calls[0]!.params[4]).toBeNull();
  });

  it("does not wrap the insert in a transaction: it is a single statement", async () => {
    const { pool, repository: audit } = repository();

    await audit.record({
      companyId: 12,
      actorUserId: 4,
      action: "message.sent",
      resourceType: "message",
      resourceId: "901",
      payload: {}
    });

    expect(pool.calls).toHaveLength(1);
    expect(pool.calls.some((call) => /BEGIN|COMMIT/i.test(call.text))).toBe(false);
  });

  it("propagates a failed insert to the caller, which is responsible for treating it as best-effort", async () => {
    const pool = {
      query: async () => { throw new Error("connection terminated"); }
    };
    const audit = new PostgresDeliveryAuditRepository(pool as unknown as pg.Pool);

    await expect(audit.record({
      companyId: 12,
      actorUserId: 4,
      action: "message.sent",
      resourceType: "message",
      resourceId: "901",
      payload: {}
    })).rejects.toThrow("connection terminated");
  });
});
