import type pg from "pg";
import { describe, expect, it } from "vitest";

import { PostgresPipelineMutationRepository } from "../src/resources/pipeline-mutations.js";

interface Call {
  text: string;
  params: unknown[];
}

interface Rows {
  rows: unknown[];
}

/**
 * El repositorio de escritura toma un cliente del pool para abrir transaccion,
 * asi que el doble tiene que exponer `connect()` ademas de `query()`.
 */
class FakePool {
  calls: Call[] = [];
  releases = 0;

  constructor(private readonly responder: (text: string) => Rows) {}

  async connect(): Promise<pg.PoolClient> {
    const client = {
      query: async (text: string, params: unknown[] = []): Promise<Rows> => {
        this.calls.push({ text, params });
        return this.responder(text);
      },
      release: (): void => {
        this.releases += 1;
      }
    };
    return client as unknown as pg.PoolClient;
  }
}

const deal = { id: 403, pipeline_id: 31, stage_id: 310 };
const stage = { id: 311, pipeline_id: 31, name: "Closed Lost" };
const updated = {
  id: 403,
  pipeline_id: 31,
  contact_id: 101,
  title: "Renovación anual",
  stage: "closed_won",
  stage_id: 311,
  value: 120_000,
  priority: "high",
  status: "open",
  due_date: null,
  assigned_to_user_id: 9,
  description: null,
  tags: null,
  custom_fields: null,
  last_activity_at: new Date("2026-08-13T15:00:00.000Z"),
  created_at: new Date("2026-08-12T09:00:00.000Z"),
  updated_at: new Date("2026-08-13T15:00:00.000Z")
};

interface Fixtures {
  deal?: unknown;
  stage?: unknown;
  updated?: unknown;
  failOnUpdate?: boolean;
}

function repository(fixtures: Fixtures = {}) {
  const rows = (value: unknown): Rows => ({ rows: value === undefined ? [] : [value] });
  const pool = new FakePool((text) => {
    if (text.includes("UPDATE deals")) {
      if (fixtures.failOnUpdate === true) throw new Error("deadlock detected");
      return rows(fixtures.updated);
    }
    if (text.includes("FROM deals")) return rows(fixtures.deal);
    if (text.includes("FROM pipeline_stages")) return rows(fixtures.stage);
    return { rows: [] };
  });
  return {
    pool,
    resources: new PostgresPipelineMutationRepository(pool as unknown as pg.Pool)
  };
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const find = (pool: FakePool, fragment: string) =>
  pool.calls.find((call) => call.text.includes(fragment));
const texts = (pool: FakePool) => pool.calls.map((call) => flat(call.text));

/**
 * Version del guardia de `pipeline-repository.test.ts` que no da por hecho que
 * la empresa sea el primer parametro: en una escritura el id del recurso va
 * antes. La regla que comprueba es la misma: filtro estricto, nunca laxo.
 */
function expectStrictCompanyFilter(call: Call, placeholder: string): void {
  expect(flat(call.text)).toContain(`company_id = ${placeholder}`);
  expect(call.text).not.toMatch(/company_id\s+IS\s+NULL/i);
  expect(call.text).not.toMatch(/OR\s+\w*\.?company_id/i);
}

describe("deal stage write repository", () => {
  it("changes the stage inside one transaction marked as API traffic", async () => {
    const { pool, resources } = repository({ deal, stage, updated });

    const result = await resources.changeDealStage(12, 403, 7, 311);

    expect(result).toEqual({ ok: true, deal: expect.objectContaining({ id: "403" }) });
    expect(texts(pool)[0]).toBe("BEGIN");
    expect(texts(pool)[1]).toBe("SELECT set_config('zinto.integration_api_origin', 'api', true)");
    expect(texts(pool).at(-1)).toBe("COMMIT");
    expect(texts(pool)).not.toContain("ROLLBACK");
    expect(pool.releases).toBe(1);
  });

  it("reads the deal and the target stage scoped to the company", async () => {
    const { pool, resources } = repository({ deal, stage, updated });

    await resources.changeDealStage(12, 403, 7, 311);

    const dealRead = find(pool, "FROM deals")!;
    expectStrictCompanyFilter(dealRead, "$2");
    expect(dealRead.params).toEqual([403, 12]);

    const stageRead = find(pool, "FROM pipeline_stages")!;
    expect(flat(stageRead.text)).toContain("pipeline_stages.company_id = $2");
    expect(flat(stageRead.text)).toContain("pipelines.company_id = $2");
    expect(stageRead.text).not.toMatch(/company_id\s+IS\s+NULL/i);
    expect(stageRead.params).toEqual([311, 12]);
  });

  it("never writes the legacy stage text without the stage reference", async () => {
    const { pool, resources } = repository({ deal, stage, updated });

    await resources.changeDealStage(12, 403, 7, 311);

    const update = find(pool, "UPDATE deals")!;
    const sql = flat(update.text);
    expect(sql).toContain("SET stage_id = $3");
    expect(sql).toContain("stage = $4");
    expect(sql).toContain("updated_at = now()");
    expect(sql).toContain("last_activity_at = now()");
    for (const call of pool.calls) {
      if (/set\s+stage\s*=/i.test(flat(call.text))) {
        expect(flat(call.text)).toContain("stage_id =");
      }
    }
  });

  it("keeps the company filter on the update itself, not only on the read", async () => {
    const { pool, resources } = repository({ deal, stage, updated });

    await resources.changeDealStage(12, 403, 7, 311);

    const update = find(pool, "UPDATE deals")!;
    expectStrictCompanyFilter(update, "$2");
    expect(flat(update.text)).toContain("WHERE id = $1 AND company_id = $2");
    expect(update.params).toEqual([403, 12, 311, "closed_won"]);
  });

  it("stores the legacy enum produced by the replicated mapper, bug included", async () => {
    const { pool, resources } = repository({
      deal,
      stage: { ...stage, name: "Envio prop" },
      updated: { ...updated, stage: "lead" }
    });

    const result = await resources.changeDealStage(12, 403, 7, 311);

    expect(find(pool, "UPDATE deals")!.params[3]).toBe("lead");
    expect(result).toEqual({ ok: true, deal: expect.objectContaining({ stage_key: "lead" }) });
  });

  it("credits the activity to the API key user, never to the legacy fallback", async () => {
    const { pool, resources } = repository({ deal, stage, updated });

    await resources.changeDealStage(12, 403, 7, 311);

    const activity = find(pool, "INSERT INTO deal_activities")!;
    const sql = flat(activity.text);
    expect(sql).toContain("(deal_id, user_id, type, content, metadata, created_at)");
    expect(sql).toContain("'stage_change'");
    expect(sql).toContain("'Deal moved to ' || $3 || ' stage'");
    expect(activity.params[0]).toBe(403);
    // 7 es el usuario de la clave; 9 es `assigned_to_user_id` del deal, el
    // respaldo del motor que este proyecto no repite.
    expect(activity.params[1]).toBe(7);
    expect(activity.params[1]).not.toBe(updated.assigned_to_user_id);
    expect(activity.params[2]).toBe("Closed Lost");
    // El motor guarda numeros en esta metadata; nuestra convencion de cadenas
    // solo aplica al JSON que ve el partner.
    expect(JSON.parse(activity.params[3] as string)).toEqual({
      previousStageId: 310,
      newStageId: 311,
      pipelineId: 31
    });
  });

  it("records the audit trail and the outbox event in the same transaction", async () => {
    const { pool, resources } = repository({ deal, stage, updated });

    const result = await resources.changeDealStage(12, 403, 7, 311);

    const audit = find(pool, "integration_api_audit_records")!;
    expect(audit.params.slice(0, 5)).toEqual([12, 7, "deal.stage.changed", "deal", 403]);
    const outbox = find(pool, "integration_api_outbox")!;
    expect(outbox.params.slice(0, 4)).toEqual([12, "deal.stage.changed", "deal", 403]);
    expect(JSON.parse(outbox.params[4] as string)).toEqual(
      result.ok ? result.deal : undefined
    );
    expect(texts(pool).indexOf("COMMIT")).toBeGreaterThan(
      pool.calls.findIndex((call) => call.text.includes("integration_api_outbox"))
    );
  });

  it("returns the deal with the stage name of the stage it just moved to", async () => {
    const { resources } = repository({ deal, stage, updated });

    const result = await resources.changeDealStage(12, 403, 7, 311);

    expect(result.ok && result.deal).toEqual({
      id: "403",
      pipeline_id: "31",
      contact_id: "101",
      title: "Renovación anual",
      stage_key: "closed_won",
      stage_id: "311",
      stage_name: "Closed Lost",
      value: 120_000,
      priority: "high",
      status: "open",
      due_date: null,
      assigned_to_user_id: "9",
      description: null,
      tags: [],
      custom_fields: {},
      last_activity_at: "2026-08-13T15:00:00.000Z",
      created_at: "2026-08-12T09:00:00.000Z",
      updated_at: "2026-08-13T15:00:00.000Z"
    });
  });

  it("writes nothing when the deal belongs to another company", async () => {
    const { pool, resources } = repository({ stage, updated });

    const result = await resources.changeDealStage(12, 900, 7, 311);

    expect(result).toEqual({ ok: false, reason: "deal_not_found" });
    expect(find(pool, "UPDATE deals")).toBeUndefined();
    expect(find(pool, "INSERT INTO deal_activities")).toBeUndefined();
    expect(find(pool, "integration_api_outbox")).toBeUndefined();
  });

  it("writes nothing when the target stage is absent or from another company", async () => {
    const { pool, resources } = repository({ deal, updated });

    const result = await resources.changeDealStage(12, 403, 7, 999);

    expect(result).toEqual({ ok: false, reason: "stage_not_found" });
    expect(find(pool, "UPDATE deals")).toBeUndefined();
    expect(find(pool, "INSERT INTO deal_activities")).toBeUndefined();
  });

  it("refuses a stage of a different pipeline instead of moving the deal", async () => {
    const { pool, resources } = repository({
      deal,
      stage: { id: 801, pipeline_id: 32, name: "Soporte" },
      updated
    });

    const result = await resources.changeDealStage(12, 403, 7, 801);

    expect(result).toEqual({ ok: false, reason: "pipeline_mismatch" });
    expect(find(pool, "UPDATE deals")).toBeUndefined();
    expect(texts(pool)).not.toContain("ROLLBACK");
  });

  it("reports the deal as missing when the update races with a deletion", async () => {
    const { pool, resources } = repository({ deal, stage });

    const result = await resources.changeDealStage(12, 403, 7, 311);

    expect(result).toEqual({ ok: false, reason: "deal_not_found" });
    expect(find(pool, "UPDATE deals")).toBeDefined();
    expect(find(pool, "INSERT INTO deal_activities")).toBeUndefined();
    expect(find(pool, "integration_api_audit_records")).toBeUndefined();
  });

  it("rolls back and releases the client when the write fails", async () => {
    const { pool, resources } = repository({ deal, stage, failOnUpdate: true });

    await expect(resources.changeDealStage(12, 403, 7, 311)).rejects.toThrow("deadlock detected");
    expect(texts(pool)).toContain("ROLLBACK");
    expect(texts(pool)).not.toContain("COMMIT");
    expect(pool.releases).toBe(1);
  });
});
