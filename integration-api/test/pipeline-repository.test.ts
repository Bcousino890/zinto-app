import type pg from "pg";
import { describe, expect, it } from "vitest";

import { encodeCursor } from "../src/http/pagination.js";
import { PostgresPipelineRepository } from "../src/resources/pipelines.js";

interface Call {
  text: string;
  params: unknown[];
}

class FakePool {
  calls: Call[] = [];

  constructor(private readonly responses: Array<{ rows: unknown[] }> = []) {}

  async query(text: string, params: unknown[]): Promise<{ rows: unknown[] }> {
    this.calls.push({ text, params });
    return this.responses[this.calls.length - 1] ?? { rows: [] };
  }
}

function repository(responses: Array<{ rows: unknown[] }> = []) {
  const pool = new FakePool(responses);
  return { pool, resources: new PostgresPipelineRepository(pool as unknown as pg.Pool) };
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const page = { cursor: null, limit: 50, updatedSince: null };

/** Un filtro laxo por empresa filtraria plantillas globales entre empresas. */
function expectStrictCompanyFilter(call: Call): void {
  expect(flat(call.text)).toContain("company_id = $1");
  expect(call.text).not.toMatch(/company_id\s+IS\s+NULL/i);
  expect(call.text).not.toMatch(/OR\s+\w*\.?company_id/i);
}

describe("pipeline read repository", () => {
  it("filters pipelines strictly by company and asks for one extra row", async () => {
    const { pool, resources } = repository([{
      rows: [{
        id: 31,
        name: "Ventas",
        description: null,
        icon: null,
        color: null,
        is_default: true,
        is_template: false,
        template_category: null,
        order_num: 0,
        created_by: 4,
        created_at: new Date("2026-08-11T10:00:00.000Z"),
        updated_at: new Date("2026-08-12T10:00:00.000Z")
      }]
    }]);

    const result = await resources.listPipelines(12, { ...page, limit: 2 });

    expect(pool.calls).toHaveLength(1);
    expectStrictCompanyFilter(pool.calls[0]!);
    expect(pool.calls[0]!.params).toEqual([12, null, null, null, 3]);
    expect(flat(pool.calls[0]!.text)).toContain("ORDER BY created_at DESC, id DESC");
    expect(result.items[0]).toEqual({
      id: "31",
      name: "Ventas",
      description: null,
      icon: null,
      color: null,
      is_default: true,
      is_template: false,
      template_category: null,
      order_num: 0,
      created_by_user_id: "4",
      created_at: "2026-08-11T10:00:00.000Z",
      updated_at: "2026-08-12T10:00:00.000Z"
    });
    expect(result.hasMore).toBe(false);
  });

  it("passes updated_since and the decoded cursor as bound parameters", async () => {
    const { pool, resources } = repository();
    const cursor = encodeCursor({ id: "31", createdAt: "2026-08-11T10:00:00.000Z" });

    await resources.listPipelines(12, {
      cursor,
      limit: 10,
      updatedSince: "2026-08-12T00:00:00.000Z"
    });

    expect(pool.calls[0]!.params).toEqual([
      12,
      "2026-08-12T00:00:00.000Z",
      "2026-08-11T10:00:00.000Z",
      31,
      11
    ]);
    expect(flat(pool.calls[0]!.text)).toContain("updated_at >= $2::timestamp");
  });

  it("never reads stages of a pipeline the company does not own", async () => {
    const { pool, resources } = repository([{ rows: [{ exists: false }] }]);

    const result = await resources.listStages(12, 80, page);

    expect(result).toBeNull();
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]!.params).toEqual([80, 12]);
    expect(flat(pool.calls[0]!.text)).toContain("FROM pipelines WHERE id = $1 AND company_id = $2");
  });

  it("scopes stages to the pipeline and to the company at once", async () => {
    const { pool, resources } = repository([
      { rows: [{ exists: true }] },
      {
        rows: [{
          id: 311,
          pipeline_id: 31,
          name: "Propuesta enviada",
          color: "#f59e0b",
          order_num: 1,
          created_at: new Date("2026-08-11T11:00:00.000Z"),
          updated_at: new Date("2026-08-12T11:00:00.000Z")
        }]
      }
    ]);

    const result = await resources.listStages(12, 31, page);

    expect(pool.calls).toHaveLength(2);
    const stages = flat(pool.calls[1]!.text);
    expect(stages).toContain("pipeline_stages");
    expect(stages).toContain("pipeline_stages.pipeline_id = $1");
    expect(stages).toContain("pipeline_stages.company_id = $2");
    expect(stages).toContain("pipelines.company_id = $2");
    expect(pool.calls[1]!.params).toEqual([31, 12, null, null, null, 51]);
    expect(result?.items[0]).toEqual({
      id: "311",
      pipeline_id: "31",
      name: "Propuesta enviada",
      color: "#f59e0b",
      order_num: 1,
      created_at: "2026-08-11T11:00:00.000Z",
      updated_at: "2026-08-12T11:00:00.000Z"
    });
  });

  it("keeps the legacy stage text apart from the configurable stage", async () => {
    const { pool, resources } = repository([{
      rows: [{
        id: 403,
        pipeline_id: 31,
        contact_id: 101,
        title: "Renovación anual",
        stage: "lead",
        stage_id: 310,
        stage_name: "Contacto inicial",
        value: 120_000,
        priority: "high",
        status: "open",
        due_date: null,
        assigned_to_user_id: 4,
        description: null,
        tags: null,
        custom_fields: null,
        last_activity_at: null,
        created_at: new Date("2026-08-12T09:00:00.000Z"),
        updated_at: new Date("2026-08-13T09:00:00.000Z")
      }]
    }]);

    const result = await resources.listDeals(12, { ...page, pipelineId: null, contactId: null });

    expectStrictCompanyFilter(pool.calls[0]!);
    expect(result.items[0]).toEqual({
      id: "403",
      pipeline_id: "31",
      contact_id: "101",
      title: "Renovación anual",
      stage_key: "lead",
      stage_id: "310",
      stage_name: "Contacto inicial",
      value: 120_000,
      priority: "high",
      status: "open",
      due_date: null,
      assigned_to_user_id: "4",
      description: null,
      tags: [],
      custom_fields: {},
      last_activity_at: null,
      created_at: "2026-08-12T09:00:00.000Z",
      updated_at: "2026-08-13T09:00:00.000Z"
    });
  });

  it("resolves the stage name only inside the same pipeline and company", async () => {
    const { pool, resources } = repository();

    await resources.listDeals(12, { ...page, pipelineId: 31, contactId: 101 });

    const sql = flat(pool.calls[0]!.text);
    expect(sql).toContain("LEFT JOIN pipeline_stages");
    expect(sql).toContain("pipeline_stages.pipeline_id = deals.pipeline_id");
    expect(sql).toContain("pipeline_stages.company_id = deals.company_id");
    expect(pool.calls[0]!.params).toEqual([12, 31, 101, null, null, null, 51]);
  });

  it("returns null for a deal outside the company", async () => {
    const { pool, resources } = repository([{ rows: [] }]);

    expect(await resources.findDeal(12, 900)).toBeNull();
    expectStrictCompanyFilter(pool.calls[0]!);
    expect(pool.calls[0]!.params).toEqual([12, 900]);
  });

  it("exposes the free text assignee of a task without resolving it to a user", async () => {
    const { pool, resources } = repository([{
      rows: [{
        id: 602,
        contact_id: 102,
        title: "Llamar para confirmar propuesta",
        description: null,
        priority: "high",
        status: "pending",
        due_date: null,
        completed_at: null,
        assigned_to: "Equipo comercial",
        category: null,
        tags: ["llamada"],
        background_color: null,
        created_by: 4,
        updated_by: null,
        created_at: new Date("2026-08-12T08:00:00.000Z"),
        updated_at: new Date("2026-08-13T08:00:00.000Z")
      }]
    }]);

    const result = await resources.listTasks(12, { ...page, contactId: 102 });

    expectStrictCompanyFilter(pool.calls[0]!);
    expect(pool.calls[0]!.params).toEqual([12, 102, null, null, null, 51]);
    expect(result.items[0]).toEqual({
      id: "602",
      contact_id: "102",
      title: "Llamar para confirmar propuesta",
      description: null,
      priority: "high",
      status: "pending",
      due_date: null,
      completed_at: null,
      assigned_to: "Equipo comercial",
      category: null,
      tags: ["llamada"],
      background_color: null,
      created_by_user_id: "4",
      updated_by_user_id: null,
      created_at: "2026-08-12T08:00:00.000Z",
      updated_at: "2026-08-13T08:00:00.000Z"
    });
  });

  it("reports another page when the extra row comes back", async () => {
    const rows = Array.from({ length: 3 }, (_value, index) => ({
      id: 600 + index,
      contact_id: 101,
      title: `Tarea ${index}`,
      description: null,
      priority: "low",
      status: "pending",
      due_date: null,
      completed_at: null,
      assigned_to: null,
      category: null,
      tags: [],
      background_color: null,
      created_by: null,
      updated_by: null,
      created_at: new Date(`2026-08-1${index + 1}T08:00:00.000Z`),
      updated_at: new Date(`2026-08-1${index + 1}T08:00:00.000Z`)
    }));
    const { resources } = repository([{ rows }]);

    const result = await resources.listTasks(12, { ...page, limit: 2, contactId: null });

    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe(encodeCursor({ id: "601", createdAt: "2026-08-12T08:00:00.000Z" }));
  });
});
