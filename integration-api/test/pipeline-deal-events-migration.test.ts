import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "migrations/005_pipeline_deal_outbox_events.sql"), "utf8");

describe("pipeline/deal CRM event migration", () => {
  it("recreates one trigger for every CRM-owned resource", () => {
    expect(sql.match(/CREATE TRIGGER/g)).toHaveLength(3);
    for (const table of ["pipelines", "pipeline_stages", "deals"]) {
      expect(sql).toContain(`DROP TRIGGER IF EXISTS integration_api_${table}_outbox ON ${table};`);
      expect(sql).toContain(`AFTER INSERT OR UPDATE OR DELETE ON ${table}`);
    }
  });

  it("skips API writes and tenantless rows", () => {
    expect(sql.match(/current_setting\('zinto\.integration_api_origin', true\)/g)).toHaveLength(3);
    expect(sql.match(/IF company_id_value IS NULL/g)).toHaveLength(3);
    expect(sql.match(/RETURN COALESCE\(NEW, OLD\)/g)!.length).toBeGreaterThanOrEqual(6);
  });

  it("classifies deal stage and pipeline changes without duplicate branches", () => {
    expect(sql).toContain("'deal.pipeline.updated'");
    expect(sql).toContain("'deal.stage.updated'");
    expect(sql).toContain("NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id");
    expect(sql).toContain("NEW.stage_id IS DISTINCT FROM OLD.stage_id");
    expect(sql).toContain("NEW.stage IS DISTINCT FROM OLD.stage");
  });

  it("uses explicit outbox payloads", () => {
    expect(sql.match(/INSERT INTO integration_api_outbox/g)).toHaveLength(3);
    expect(sql.match(/jsonb_build_object/g)).toHaveLength(3);
    expect(sql).not.toContain("SELECT *");
    expect(sql).not.toContain("row_to_json");
  });
});
