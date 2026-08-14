import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { webhookEventTypes } from "../src/webhooks/event-types.js";

const migrationPath = fileURLToPath(new URL("../migrations/003_bidirectional_events_outbox.sql", import.meta.url));
const contactRepositoryPath = fileURLToPath(new URL("../src/resources/contact-mutations.ts", import.meta.url));

function sql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("bidirectional event migration", () => {
  it("catalogues every advertised event at schema version 1", () => {
    const migration = sql();
    const catalogued = [...migration.matchAll(/\('([^']+)',\s*1\)/g)].map((match) => match[1]);

    expect([...new Set(catalogued)].sort()).toEqual([...webhookEventTypes].sort());
    expect(migration).toContain("schema_version INTEGER NOT NULL CHECK (schema_version > 0)");
    expect(migration).toContain("integration_api_outbox_schema_version_check");
  });

  it("installs guarded triggers for every prioritized table family", () => {
    const migration = sql();
    for (const table of [
      "deals", "pipelines", "pipeline_stages", "contact_tasks", "products", "stock_levels",
      "stock_movements", "stock_transfers", "sales_orders", "suppliers", "purchase_orders",
      "invoices", "invoice_payments", "flows", "flow_executions"
    ]) {
      expect(migration).toContain(`to_regclass('public.${table}')`);
      expect(migration).toContain(`ON ${table}`);
    }
  });

  it("derives tenant ownership from rows and suppresses metadata-only updates", () => {
    const migration = sql();

    expect(migration).toContain("row_data ->> 'company_id'");
    expect(migration).toContain("NEW.company_id");
    expect(migration).toContain("to_jsonb(NEW) - 'updated_at'");
    expect(migration).toContain("IS NOT DISTINCT FROM to_jsonb(OLD) - 'updated_at'");
  });

  it("adds database and delivery deduplication without collapsing legitimate events", () => {
    const migration = sql();

    expect(migration).toContain("deduplication_key TEXT");
    expect(migration).toContain("integration_api_outbox_company_dedup_idx");
    expect(migration).toContain("WHERE deduplication_key IS NOT NULL");
    expect(migration).toContain("ON CONFLICT (company_id, deduplication_key)");
    expect(migration).toContain("UNIQUE (endpoint_id, outbox_id)");
  });

  it("does not expose Flow graph or execution context in webhook payloads", () => {
    const migration = sql();

    expect(migration).toContain("flow_payload := row_data - 'company_id' - 'nodes' - 'edges' - 'custom_variables'");
    expect(migration).toContain("execution_path");
    expect(migration).toContain("context_data");
    expect(migration).toContain("flow_payload := flow_payload - 'execution_path' - 'context_data'");
    expect(migration).not.toMatch(/integration_api_capture_generic_event[\s\S]+ON employees/);
  });

  it("uses row triggers as the only API outbox writer", () => {
    const repository = readFileSync(contactRepositoryPath, "utf8");

    expect(repository).toContain("zinto.integration_api_origin");
    expect(repository).not.toContain("INSERT INTO integration_api_outbox");
    expect(repository).toContain("integration_api_audit_records");
  });
});
