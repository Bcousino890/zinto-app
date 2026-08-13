import type pg from "pg";
import { describe, expect, it } from "vitest";
import { PostgresPipelineCrudRepository } from "../src/resources/pipeline-crud.js";

type Call = { text: string; params: unknown[] };
class Pool {
  calls: Call[] = [];
  releases = 0;
  constructor(private readonly rows: (text: string) => unknown[] = () => []) {}
  async connect(): Promise<pg.PoolClient> {
    const client = {
      query: async (text: string, params: unknown[] = []) => { this.calls.push({ text, params }); return { rows: this.rows(text) }; },
      release: () => { this.releases += 1; }
    };
    return client as unknown as pg.PoolClient;
  }
}
const pipeline = { id: 31, name: "Ventas", description: null, icon: null, color: "#123456", is_default: false, is_template: false, template_category: null, order_num: 1, created_by: 7, created_at: new Date("2026-08-13T10:00:00Z"), updated_at: new Date("2026-08-13T10:00:00Z") };
const stage = { id: 310, pipeline_id: 31, name: "Nuevo", color: "#123456", order_num: 0, created_at: new Date("2026-08-13T10:00:00Z"), updated_at: new Date("2026-08-13T10:00:00Z") };
const flat = (value: string) => value.replace(/\s+/g, " ").trim();

describe("pipeline CRUD repository", () => {
  it("creates a pipeline in an API transaction and records audit plus outbox", async () => {
    const pool = new Pool((text) => text.includes("INSERT INTO pipelines") ? [pipeline] : []);
    const result = await new PostgresPipelineCrudRepository(pool as unknown as pg.Pool).createPipeline(12, 7, { name: "Ventas" });
    expect(result.id).toBe("31");
    expect(flat(pool.calls[0]!.text)).toBe("BEGIN");
    expect(flat(pool.calls[1]!.text)).toContain("set_config('zinto.integration_api_origin','api',true)");
    expect(pool.calls.some((call) => call.text.includes("company_id,name"))).toBe(true);
    expect(pool.calls.some((call) => call.text.includes("integration_api_audit_records"))).toBe(true);
    expect(pool.calls.some((call) => call.text.includes("integration_api_outbox"))).toBe(true);
    expect(flat(pool.calls.at(-1)!.text)).toBe("COMMIT");
    expect(pool.releases).toBe(1);
  });

  it("scopes stage updates to both pipeline and company", async () => {
    const pool = new Pool((text) => text.includes("UPDATE pipeline_stages") ? [stage] : []);
    const result = await new PostgresPipelineCrudRepository(pool as unknown as pg.Pool).updateStage(12, 31, 310, { name: "Cualificado" });
    expect(result?.id).toBe("310");
    const update = pool.calls.find((call) => call.text.includes("UPDATE pipeline_stages"))!;
    expect(flat(update.text)).toContain("WHERE id=$1 AND pipeline_id=$2 AND company_id=$3");
    expect(update.params.slice(0, 3)).toEqual([310, 31, 12]);
  });

  it("refuses to delete a pipeline that still has deals", async () => {
    const pool = new Pool((text) => text.includes("SELECT id FROM pipelines") ? [{ id: 31 }] : text.includes("FROM deals") ? [{ exists: 1 }] : []);
    const result = await new PostgresPipelineCrudRepository(pool as unknown as pg.Pool).deletePipeline(12, 31);
    expect(result).toEqual({ ok: false, reason: "pipeline_in_use" });
    expect(pool.calls.some((call) => call.text.startsWith("DELETE FROM pipelines"))).toBe(false);
  });
});
