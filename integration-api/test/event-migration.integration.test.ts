import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.INTEGRATION_TEST_DATABASE_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const fixture = readFileSync(fileURLToPath(new URL("./fixtures/event-schema.sql", import.meta.url)), "utf8");
const migration001 = readFileSync(fileURLToPath(new URL("../migrations/001_integration_api.sql", import.meta.url)), "utf8");
const migration003 = readFileSync(fileURLToPath(new URL("../migrations/003_bidirectional_events_outbox.sql", import.meta.url)), "utf8");

integration("bidirectional event migration on PostgreSQL", () => {
  const pool = new pg.Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    await pool.query(fixture);
    await pool.query(migration001);
    await pool.query(migration003);
    await pool.query(migration003);
    await pool.query("INSERT INTO companies (id) VALUES (11), (22); INSERT INTO users (id, company_id) VALUES (1, 11)");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("captures API and CRM writes in the owning tenant only", async () => {
    await pool.query("INSERT INTO contacts (company_id, name) VALUES (11, 'Tenant 11'), (22, 'Tenant 22')");
    await pool.query("TRUNCATE integration_api_outbox RESTART IDENTITY CASCADE");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('zinto.integration_api_origin', 'api', true)");
      await client.query("UPDATE contacts SET name = 'API update', updated_at = NOW() WHERE id = 1 AND company_id = 11");
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    await pool.query("UPDATE contacts SET name = 'CRM update', updated_at = NOW() WHERE id = 2 AND company_id = 22");

    const result = await pool.query<{ company_id: number; origin: string }>(
      `SELECT company_id, payload #>> '{_meta,origin}' AS origin
         FROM integration_api_outbox ORDER BY id`
    );
    expect(result.rows).toEqual([
      { company_id: 11, origin: "api" },
      { company_id: 22, origin: "crm" }
    ]);
  });

  it("emits one stage transition and suppresses updated_at-only changes", async () => {
    await pool.query("TRUNCATE integration_api_outbox RESTART IDENTITY CASCADE");
    await pool.query("INSERT INTO deals (company_id, title, stage_id, pipeline_id, stage) VALUES (11, 'Deal', 1, 1, 'lead')");
    await pool.query("TRUNCATE integration_api_outbox RESTART IDENTITY CASCADE");
    await pool.query("UPDATE deals SET stage_id = 2, stage = 'qualified', updated_at = NOW() WHERE id = 1 AND company_id = 11");
    await pool.query("UPDATE deals SET updated_at = NOW() WHERE id = 1 AND company_id = 11");

    const result = await pool.query(
      "SELECT company_id, event_type, payload->>'previous_stage_id' AS previous_stage_id FROM integration_api_outbox"
    );
    expect(result.rows).toEqual([{ company_id: 11, event_type: "deal.stage.changed", previous_stage_id: "1" }]);
  });

  it("deduplicates explicit resync keys per tenant but not across tenants", async () => {
    await pool.query("TRUNCATE integration_api_outbox RESTART IDENTITY CASCADE");
    const result = await pool.query<{ event_id: string }>(
      `SELECT integration_api_enqueue_event(11, 'contact.updated', 'contact', 1, '{"id":"1"}', 'resync:contacts:1') AS event_id
       UNION ALL
       SELECT integration_api_enqueue_event(11, 'contact.updated', 'contact', 1, '{"id":"1"}', 'resync:contacts:1')
       UNION ALL
       SELECT integration_api_enqueue_event(22, 'contact.updated', 'contact', 2, '{"id":"2"}', 'resync:contacts:1')`
    );
    const count = await pool.query<{ count: string }>("SELECT COUNT(*) FROM integration_api_outbox");

    expect(result.rows[0]!.event_id).toBe(result.rows[1]!.event_id);
    expect(result.rows[2]!.event_id).not.toBe(result.rows[0]!.event_id);
    expect(count.rows[0]!.count).toBe("2");
  });

  it("omits Flow graph and execution context from payloads", async () => {
    await pool.query("TRUNCATE integration_api_outbox RESTART IDENTITY CASCADE");
    await pool.query(
      `INSERT INTO flows (company_id, name, status, nodes, edges, custom_variables)
       VALUES (11, 'Flow', 'active', '[{"secret":"node"}]', '[{"edge":1}]', '{"token":"hidden"}')`
    );
    await pool.query(
      `INSERT INTO flow_executions (company_id, flow_id, execution_id, status, execution_path, context_data, error_message)
       VALUES (11, 1, 'run-1', 'running', '["node-1"]', '{"phone":"private"}', 'internal detail')`
    );
    const result = await pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM integration_api_outbox ORDER BY id"
    );

    expect(result.rows[0]!.payload).not.toHaveProperty("nodes");
    expect(result.rows[0]!.payload).not.toHaveProperty("custom_variables");
    expect(result.rows[1]!.payload).not.toHaveProperty("context_data");
    expect(result.rows[1]!.payload).not.toHaveProperty("error_message");
  });
});
