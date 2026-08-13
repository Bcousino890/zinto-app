import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "migrations/005_pipeline_deal_outbox_events.sql"), "utf8");

describe("pipeline/deal CRM event migration", () => {
  it("documents the required migration order and avoids optional columns", () => {
    expect(migration).toContain("integration_api_outbox from 001_integration_api.sql");
    expect(migration).toContain("112_add_multi_pipeline_support.sql");
    expect(migration).toContain("Optional later columns");
    expect(migration).not.toContain("'custom_fields'");
    expect(migration).not.toContain("'created_by'");
  });

  it("defines one replaceable trigger per CRM-owned resource", () => {
    for (const table of ["pipelines", "pipeline_stages", "deals"]) {
      expect(migration).toContain(`DROP TRIGGER IF EXISTS integration_api_${table}_outbox ON ${table};`);
      expect(migration).toContain(`AFTER INSERT OR UPDATE OR DELETE ON ${table}`);
    }
    expect(migration.match(/CREATE TRIGGER/g)).toHaveLength(3);
  });

  it("skips API-originated writes in every trigger function", () => {
    expect(migration.match(/current_setting\('zinto\.integration_api_origin', true\)/g)).toHaveLength(3);
    expect(migration.match(/= 'api'/g)).toHaveLength(3);
  });

  it("does not publish rows without a tenant and handles deletes from OLD", () => {
    expect(migration.match(/event_company_id := COALESCE\(NEW\.company_id, OLD\.company_id\);/g)).toHaveLength(3);
    expect(migration.match(/IF event_company_id IS NULL/g)).toHaveLength(3);
    expect(migration.match(/COALESCE\(NEW, OLD\)/g)!.length).toBeGreaterThanOrEqual(6);
  });

  it("emits one deterministic deal event for stage or pipeline changes", () => {
    expect(migration).toContain("event_type := 'deal.pipeline.updated'");
    expect(migration).toContain("event_type := 'deal.stage.updated'");
    expect(migration).toContain("event_type := 'deal.updated'");
    expect(migration).toContain("NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id");
    expect(migration).toContain("NEW.stage_id IS DISTINCT FROM OLD.stage_id");
    expect(migration).toContain("NEW.stage IS DISTINCT FROM OLD.stage");
  });

  it("writes explicit payloads to the integration outbox", () => {
    expect(migration.match(/INSERT INTO integration_api_outbox/g)).toHaveLength(3);
    expect(migration.match(/jsonb_build_object/g)).toHaveLength(3);
    expect(migration).not.toContain("row_to_json");
    expect(migration).not.toContain("SELECT *");
  });
});
