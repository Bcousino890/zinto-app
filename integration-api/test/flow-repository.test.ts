import type pg from "pg";
import { describe, expect, it } from "vitest";

import { PostgresFlowRepository } from "../src/resources/flows.js";

interface Call { text: string; params: unknown[] }

class FakePool {
  calls: Call[] = [];
  constructor(private readonly responses: Array<{ rows: unknown[] }> = []) {}
  async query(text: string, params: unknown[]): Promise<{ rows: unknown[] }> {
    this.calls.push({ text, params });
    return this.responses[this.calls.length - 1] ?? { rows: [] };
  }
}

const flat = (value: string) => value.replace(/\s+/g, " ").trim();
const page = { cursor: null, limit: 50, updatedSince: null };

function setup(responses: Array<{ rows: unknown[] }> = []) {
  const pool = new FakePool(responses);
  return { pool, repository: new PostgresFlowRepository(pool as unknown as pg.Pool) };
}

describe("flow read repository", () => {
  it("lists only flow metadata owned by the authenticated company", async () => {
    const { pool, repository } = setup([{ rows: [{
      id: 7, user_id: 4, name: "Cobro", description: null, status: "active", version: 3,
      created_at: new Date("2026-08-10T10:00:00Z"), updated_at: new Date("2026-08-11T10:00:00Z")
    }] }]);

    const result = await repository.listFlows(12, page);

    expect(flat(pool.calls[0]!.text)).toContain("FROM flows WHERE company_id = $1");
    expect(pool.calls[0]!.text).not.toMatch(/nodes|edges|custom_variables/);
    expect(pool.calls[0]!.params).toEqual([12, null, null, null, 51]);
    expect(result.items[0]).toEqual({
      id: "7", created_by_user_id: "4", name: "Cobro", description: null,
      status: "active", version: 3, created_at: "2026-08-10T10:00:00.000Z",
      updated_at: "2026-08-11T10:00:00.000Z"
    });
  });

  it("scopes assignments through both the flow and channel tenant", async () => {
    const { pool, repository } = setup([
      { rows: [{ exists: true }] },
      { rows: [{ id: 8, flow_id: 7, channel_id: 9, is_active: true,
        created_at: new Date("2026-08-10T10:00:00Z"), updated_at: new Date("2026-08-11T10:00:00Z") }] }
    ]);

    await repository.listAssignments(12, 7, page);

    const sql = flat(pool.calls[1]!.text);
    expect(sql).toContain("JOIN flows ON flows.id = flow_assignments.flow_id");
    expect(sql).toContain("JOIN channel_connections ON channel_connections.id = flow_assignments.channel_id");
    expect(sql).toContain("flows.company_id = $2");
    expect(sql).toContain("channel_connections.company_id = $2");
  });

  it("returns no execution from another tenant and omits runtime payload fields", async () => {
    const { pool, repository } = setup();

    await repository.listExecutions(12, { ...page, flowId: 7, status: "failed" });

    const sql = flat(pool.calls[0]!.text);
    expect(sql).toContain("JOIN flows ON flows.id = flow_executions.flow_id");
    expect(sql).toContain("flow_executions.company_id = $1");
    expect(sql).toContain("flows.company_id = $1");
    expect(sql).not.toMatch(/context_data|execution_path|error_message|debug_info/);
    expect(pool.calls[0]!.params).toEqual([12, 7, "failed", null, null, null, 51]);
  });

  it("returns null when a flow id is not owned by the company", async () => {
    const { pool, repository } = setup([{ rows: [] }]);
    expect(await repository.findFlow(12, 99)).toBeNull();
    expect(pool.calls[0]!.params).toEqual([12, 99]);
    expect(flat(pool.calls[0]!.text)).toContain("company_id = $1 AND id = $2");
  });
});
