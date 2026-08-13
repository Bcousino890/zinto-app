import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";
import { decodeCursor, encodeCursor } from "../src/http/pagination.js";
import type { ResourcePage } from "../src/resources/core.js";
import type {
  DealQuery,
  DealResource,
  IncrementalQuery,
  PipelineRepository,
  PipelineResource,
  PipelineStageResource,
  TaskQuery,
  TaskResource
} from "../src/resources/pipelines.js";

const CALLER = 12;
const OWNER = 77;

const rawKey = `pcp_${"c".repeat(64)}`;
const keyHash = createHash("sha256").update(rawKey.slice(4)).digest("hex");
const narrowKey = `pcp_${"d".repeat(64)}`;
const narrowHash = createHash("sha256").update(narrowKey.slice(4)).digest("hex");
const foreignKey = `pcp_${"e".repeat(64)}`;
const foreignHash = createHash("sha256").update(foreignKey.slice(4)).digest("hex");

const authorization = { authorization: `Bearer ${rawKey}` };
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

const readScopes = ["pipelines:read", "deals:read", "tasks:read"];

const keys: ApiKeyRecord[] = [
  {
    id: 8,
    companyId: CALLER,
    companyName: "Empresa que llama",
    userId: 4,
    name: "Partner integration",
    keyHash,
    permissions: readScopes,
    isActive: true,
    expiresAt: null,
    allowedIps: []
  },
  {
    id: 9,
    companyId: CALLER,
    companyName: "Empresa que llama",
    userId: 4,
    name: "Clave sin permisos de pipeline",
    keyHash: narrowHash,
    permissions: ["contacts:read"],
    isActive: true,
    expiresAt: null,
    allowedIps: []
  },
  {
    id: 10,
    companyId: OWNER,
    companyName: "Otra empresa",
    userId: 5,
    name: "Clave de otra empresa",
    keyHash: foreignHash,
    permissions: readScopes,
    isActive: true,
    expiresAt: null,
    allowedIps: []
  }
];

class MemoryApiKeys implements ApiKeyRepository {
  async findByHash(hash: string): Promise<ApiKeyRecord | null> {
    return keys.find((key) => key.keyHash === hash) ?? null;
  }

  async markUsed(): Promise<void> {}
}

type Owned<T> = T & { companyId: number };

const pipelines: Owned<PipelineResource>[] = [
  {
    companyId: CALLER,
    id: "31",
    name: "Ventas",
    description: "Embudo comercial",
    icon: "trending-up",
    color: "#2563eb",
    is_default: true,
    is_template: false,
    template_category: null,
    order_num: 0,
    created_by_user_id: "4",
    created_at: "2026-08-11T10:00:00.000Z",
    updated_at: "2026-08-12T10:00:00.000Z"
  },
  {
    companyId: CALLER,
    id: "32",
    name: "Soporte",
    description: null,
    icon: null,
    color: null,
    is_default: false,
    is_template: false,
    template_category: null,
    order_num: 1,
    created_by_user_id: null,
    created_at: "2026-08-12T10:00:00.000Z",
    updated_at: "2026-08-13T10:00:00.000Z"
  },
  {
    companyId: OWNER,
    id: "80",
    name: "Pipeline de otra empresa",
    description: "Plantilla privada de otra empresa",
    icon: null,
    color: null,
    is_default: false,
    is_template: true,
    template_category: "ventas",
    order_num: 0,
    created_by_user_id: "5",
    created_at: "2026-08-13T10:00:00.000Z",
    updated_at: "2026-08-13T10:00:00.000Z"
  }
];

const stages: Owned<PipelineStageResource>[] = [
  {
    companyId: CALLER,
    id: "311",
    pipeline_id: "31",
    name: "Propuesta enviada",
    color: "#f59e0b",
    order_num: 1,
    created_at: "2026-08-11T11:00:00.000Z",
    updated_at: "2026-08-12T11:00:00.000Z"
  },
  {
    companyId: CALLER,
    id: "310",
    pipeline_id: "31",
    name: "Contacto inicial",
    color: "#22c55e",
    order_num: 0,
    created_at: "2026-08-11T10:30:00.000Z",
    updated_at: "2026-08-11T10:30:00.000Z"
  },
  {
    // Misma empresa, pipeline distinto: nunca debe salir al listar el 31.
    companyId: CALLER,
    id: "320",
    pipeline_id: "32",
    name: "Ticket abierto",
    color: "#0ea5e9",
    order_num: 0,
    created_at: "2026-08-12T10:30:00.000Z",
    updated_at: "2026-08-12T10:30:00.000Z"
  },
  {
    companyId: OWNER,
    id: "800",
    pipeline_id: "80",
    name: "Etapa de otra empresa",
    color: "#111111",
    order_num: 0,
    created_at: "2026-08-13T10:30:00.000Z",
    updated_at: "2026-08-13T10:30:00.000Z"
  }
];

const deals: Owned<DealResource>[] = [
  {
    companyId: CALLER,
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
    due_date: "2026-09-01T00:00:00.000Z",
    assigned_to_user_id: "4",
    description: null,
    tags: ["renovacion"],
    custom_fields: {},
    last_activity_at: "2026-08-13T09:00:00.000Z",
    created_at: "2026-08-12T09:00:00.000Z",
    updated_at: "2026-08-13T09:00:00.000Z"
  },
  {
    companyId: CALLER,
    id: "402",
    pipeline_id: "31",
    contact_id: "102",
    title: "Ampliación de licencias",
    stage_key: "qualified",
    stage_id: "311",
    stage_name: "Propuesta enviada",
    value: null,
    priority: null,
    status: "open",
    due_date: null,
    assigned_to_user_id: null,
    description: "Pendiente de firma",
    tags: [],
    custom_fields: { origen: "feria" },
    last_activity_at: null,
    // Mismo created_at que el 403: fuerza el desempate por id.
    created_at: "2026-08-12T09:00:00.000Z",
    updated_at: "2026-08-12T09:30:00.000Z"
  },
  {
    companyId: CALLER,
    id: "401",
    pipeline_id: "32",
    contact_id: "101",
    title: "Incidencia facturación",
    stage_key: "lead",
    // Referencia colgante: la etapa no pertenece a este pipeline.
    stage_id: "999",
    stage_name: null,
    value: 0,
    priority: "low",
    status: "open",
    due_date: null,
    assigned_to_user_id: null,
    description: null,
    tags: [],
    custom_fields: {},
    last_activity_at: null,
    created_at: "2026-08-11T09:00:00.000Z",
    updated_at: "2026-08-11T09:00:00.000Z"
  },
  {
    companyId: OWNER,
    id: "900",
    pipeline_id: "80",
    contact_id: "500",
    title: "Negocio de otra empresa",
    stage_key: "closed_won",
    stage_id: "800",
    stage_name: "Etapa de otra empresa",
    value: 999,
    priority: "high",
    status: "won",
    due_date: null,
    assigned_to_user_id: "5",
    description: "Confidencial de otra empresa",
    tags: ["privado"],
    custom_fields: {},
    last_activity_at: null,
    created_at: "2026-08-13T09:00:00.000Z",
    updated_at: "2026-08-13T09:00:00.000Z"
  }
];

const tasks: Owned<TaskResource>[] = [
  {
    companyId: CALLER,
    id: "602",
    contact_id: "102",
    title: "Llamar para confirmar propuesta",
    description: null,
    priority: "high",
    status: "pending",
    due_date: "2026-08-20T09:00:00.000Z",
    completed_at: null,
    assigned_to: "Equipo comercial",
    category: "seguimiento",
    tags: ["llamada"],
    background_color: "#fef3c7",
    created_by_user_id: "4",
    updated_by_user_id: null,
    created_at: "2026-08-12T08:00:00.000Z",
    updated_at: "2026-08-13T08:00:00.000Z"
  },
  {
    companyId: CALLER,
    id: "601",
    contact_id: "101",
    title: "Enviar documentación",
    description: "Adjuntar el contrato",
    priority: "medium",
    status: "done",
    due_date: null,
    completed_at: "2026-08-11T12:00:00.000Z",
    assigned_to: null,
    category: null,
    tags: [],
    background_color: null,
    created_by_user_id: "4",
    updated_by_user_id: "4",
    created_at: "2026-08-11T08:00:00.000Z",
    updated_at: "2026-08-11T12:00:00.000Z"
  },
  {
    companyId: OWNER,
    id: "990",
    contact_id: "500",
    title: "Tarea de otra empresa",
    description: "Confidencial de otra empresa",
    priority: "low",
    status: "pending",
    due_date: null,
    completed_at: null,
    assigned_to: "Nombre ajeno",
    category: null,
    tags: [],
    background_color: null,
    created_by_user_id: "5",
    updated_by_user_id: null,
    created_at: "2026-08-13T08:00:00.000Z",
    updated_at: "2026-08-13T08:00:00.000Z"
  }
];

function page<T extends { id: string; created_at: string; updated_at: string }>(
  items: T[],
  query: IncrementalQuery
): ResourcePage<T> {
  const selectable = items
    .filter((item) => query.updatedSince === null || item.updated_at >= query.updatedSince)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || Number(b.id) - Number(a.id));
  const cursor = query.cursor === null ? null : decodeCursor(query.cursor);
  const start = cursor === null
    ? 0
    : selectable.findIndex((item) => item.id === cursor.id && item.created_at === cursor.createdAt) + 1;
  const selected = selectable.slice(start, start + query.limit);
  const hasMore = start + query.limit < selectable.length;
  const last = selected.at(-1);
  return {
    items: selected,
    hasMore,
    nextCursor: hasMore && last !== undefined
      ? encodeCursor({ id: last.id, createdAt: last.created_at })
      : null
  };
}

function strip<T extends { companyId: number }>(result: ResourcePage<T>): ResourcePage<Omit<T, "companyId">> {
  return { ...result, items: result.items.map(({ companyId: _owner, ...item }) => item) };
}

class MemoryPipelines implements PipelineRepository {
  async listPipelines(companyId: number, query: IncrementalQuery) {
    return strip(page(pipelines.filter((item) => item.companyId === companyId), query));
  }

  async listStages(companyId: number, pipelineId: number, query: IncrementalQuery) {
    const pipeline = pipelines.find(
      (item) => item.companyId === companyId && item.id === String(pipelineId)
    );
    if (pipeline === undefined) return null;
    return strip(page(
      stages.filter((item) => item.companyId === companyId && item.pipeline_id === pipeline.id),
      query
    ));
  }

  async listDeals(companyId: number, query: DealQuery) {
    return strip(page(
      deals.filter((item) =>
        item.companyId === companyId &&
        (query.pipelineId === null || item.pipeline_id === String(query.pipelineId)) &&
        (query.contactId === null || item.contact_id === String(query.contactId))),
      query
    ));
  }

  async findDeal(companyId: number, dealId: number) {
    const deal = deals.find((item) => item.companyId === companyId && item.id === String(dealId));
    if (deal === undefined) return null;
    const { companyId: _owner, ...resource } = deal;
    return resource;
  }

  async listTasks(companyId: number, query: TaskQuery) {
    return strip(page(
      tasks.filter((item) =>
        item.companyId === companyId &&
        (query.contactId === null || item.contact_id === String(query.contactId))),
      query
    ));
  }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp() {
  // readOnly: false para que la ausencia de rutas de escritura se demuestre por
  // el enrutador y no la enmascare el guardia global de solo lectura.
  const app = await buildApp({
    apiKeyRepository: new MemoryApiKeys(),
    pipelineRepository: new MemoryPipelines(),
    logger: false,
    readOnly: false
  });
  apps.push(app);
  return app;
}

async function get(url: string, headers: Record<string, string> = authorization) {
  const app = await makeApp();
  return app.inject({ method: "GET", url, headers });
}

const ids = (response: { json: () => { data: Array<{ id: string }> } }) =>
  response.json().data.map((item) => item.id);

describe("pipeline read API", () => {
  it("lists only the pipelines of the calling company", async () => {
    const response = await get("/api/v1/pipelines");

    expect(response.statusCode).toBe(200);
    expect(ids(response)).toEqual(["32", "31"]);
    expect(response.body).not.toContain("otra empresa");
    expect(response.json().data[0]).toEqual({
      id: "32",
      name: "Soporte",
      description: null,
      icon: null,
      color: null,
      is_default: false,
      is_template: false,
      template_category: null,
      order_num: 1,
      created_by_user_id: null,
      created_at: "2026-08-12T10:00:00.000Z",
      updated_at: "2026-08-13T10:00:00.000Z"
    });
  });

  it("lists the stages of an owned pipeline and no stage of a sibling pipeline", async () => {
    const response = await get("/api/v1/pipelines/31/stages");

    expect(response.statusCode).toBe(200);
    expect(ids(response)).toEqual(["311", "310"]);
    expect(response.json().data.every((item: { pipeline_id: string }) => item.pipeline_id === "31")).toBe(true);
    expect(response.body).not.toContain("Ticket abierto");
  });

  it("hides the stages of a pipeline owned by another company", async () => {
    const response = await get("/api/v1/pipelines/80/stages");

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("pipeline_not_found");
    expect(response.body).not.toContain("Etapa de otra empresa");
  });

  it("rejects a non numeric pipeline ID", async () => {
    const response = await get("/api/v1/pipelines/abc/stages");

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
  });

  it("keeps the legacy stage text and the configurable stage as separate fields", async () => {
    const response = await get("/api/v1/deals/403");

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(expect.objectContaining({
      id: "403",
      stage_key: "lead",
      stage_id: "310",
      stage_name: "Contacto inicial"
    }));
    expect(response.json().data).not.toHaveProperty("stage");
  });

  it("never fabricates a stage name for a dangling stage reference", async () => {
    const response = await get("/api/v1/deals/401");

    expect(response.json().data.stage_key).toBe("lead");
    expect(response.json().data.stage_id).toBe("999");
    expect(response.json().data.stage_name).toBeNull();
  });

  it("exposes both stage vocabularies in the deal list without mixing them", async () => {
    const response = await get("/api/v1/deals");

    expect(ids(response)).toEqual(["403", "402", "401"]);
    expect(response.json().data.map((item: DealResource) => [item.stage_key, item.stage_name])).toEqual([
      ["lead", "Contacto inicial"],
      ["qualified", "Propuesta enviada"],
      ["lead", null]
    ]);
  });

  it("filters deals by pipeline and by contact", async () => {
    const byPipeline = await get("/api/v1/deals?pipeline_id=31");
    const byContact = await get("/api/v1/deals?contact_id=101");
    const both = await get("/api/v1/deals?pipeline_id=31&contact_id=101");

    expect(ids(byPipeline)).toEqual(["403", "402"]);
    expect(ids(byContact)).toEqual(["403", "401"]);
    expect(ids(both)).toEqual(["403"]);
  });

  it("returns an empty list when filtering deals by another company's pipeline", async () => {
    const response = await get("/api/v1/deals?pipeline_id=80");

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([]);
  });

  it("lists tasks with the free text assignee untouched", async () => {
    const response = await get("/api/v1/tasks");

    expect(ids(response)).toEqual(["602", "601"]);
    expect(response.json().data[0]).toEqual(expect.objectContaining({
      assigned_to: "Equipo comercial",
      contact_id: "102",
      status: "pending"
    }));
    expect(response.json().data[1].assigned_to).toBeNull();
  });

  it("filters tasks by contact", async () => {
    const response = await get("/api/v1/tasks?contact_id=101");

    expect(ids(response)).toEqual(["601"]);
  });

  it.each([
    ["/api/v1/pipelines", "32"],
    ["/api/v1/deals", "403"],
    ["/api/v1/tasks", "602"]
  ])("paginates %s with an opaque cursor down to the last page", async (path, first) => {
    const app = await makeApp();
    const seen: string[] = [];
    let url = `${path}?limit=1`;
    for (let request = 0; request < 5; request += 1) {
      const response = await app.inject({ method: "GET", url, headers: authorization });
      expect(response.statusCode).toBe(200);
      seen.push(...response.json().data.map((item: { id: string }) => item.id));
      const next = response.json().meta.next_cursor;
      if (next === null) {
        expect(response.json().meta.has_more).toBe(false);
        break;
      }
      url = `${path}?limit=1&cursor=${encodeURIComponent(next)}`;
    }

    expect(seen[0]).toBe(first);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("keeps a deterministic order when two deals share a created_at", async () => {
    const app = await makeApp();
    const first = await app.inject({ method: "GET", url: "/api/v1/deals?limit=1", headers: authorization });
    const second = await app.inject({
      method: "GET",
      url: `/api/v1/deals?limit=2&cursor=${encodeURIComponent(first.json().meta.next_cursor)}`,
      headers: authorization
    });

    expect(ids(first)).toEqual(["403"]);
    expect(ids(second)).toEqual(["402", "401"]);
    expect(second.json().meta.has_more).toBe(false);
    expect(second.json().meta.next_cursor).toBeNull();
  });

  it.each([
    "/api/v1/pipelines",
    "/api/v1/pipelines/31/stages",
    "/api/v1/deals",
    "/api/v1/tasks"
  ])("filters %s by updated_since keeping a stable order", async (path) => {
    const all = await get(path);
    const since = await get(`${path}?updated_since=2026-08-12T11:00:00.000Z`);
    const repeated = await get(`${path}?updated_since=2026-08-12T11:00:00.000Z`);

    expect(since.statusCode).toBe(200);
    expect(ids(since)).toEqual(ids(repeated));
    expect(ids(since).length).toBeLessThan(ids(all).length);
    expect(ids(since)).toEqual(ids(all).filter((id) => ids(since).includes(id)));
  });

  it("returns the records updated at the exact updated_since boundary", async () => {
    const response = await get("/api/v1/tasks?updated_since=2026-08-13T08:00:00.000Z");

    expect(ids(response)).toEqual(["602"]);
  });

  it.each([
    "/api/v1/pipelines?limit=0",
    "/api/v1/pipelines?limit=201",
    "/api/v1/pipelines?cursor=not-a-cursor",
    "/api/v1/pipelines?unknown=true",
    "/api/v1/pipelines?updated_since=ayer",
    "/api/v1/pipelines?contact_id=101",
    "/api/v1/pipelines/31/stages?pipeline_id=31",
    "/api/v1/deals?limit=0",
    "/api/v1/deals?cursor=not-a-cursor",
    "/api/v1/deals?pipeline_id=abc",
    "/api/v1/deals?contact_id=-1",
    "/api/v1/deals?unknown=true",
    "/api/v1/tasks?limit=201",
    "/api/v1/tasks?contact_id=abc",
    "/api/v1/tasks?pipeline_id=31",
    "/api/v1/tasks?updated_since=2026-13-01"
  ])("rejects invalid query input: %s", async (url) => {
    const response = await get(url);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
  });

  it.each([
    "/api/v1/pipelines",
    "/api/v1/pipelines/31/stages",
    "/api/v1/deals",
    "/api/v1/deals/403",
    "/api/v1/tasks"
  ])("requires the read scope on %s", async (url) => {
    const denied = await get(url, { authorization: `Bearer ${narrowKey}` });
    const anonymous = await get(url, {});

    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("insufficient_scope");
    expect(anonymous.statusCode).toBe(401);
  });

  it.each([
    "POST",
    "PATCH",
    "PUT",
    "DELETE"
  ] as const)("exposes no %s route on the phase D read resources", async (method) => {
    const app = await makeApp();
    const responses = await Promise.all([
      "/api/v1/pipelines",
      "/api/v1/pipelines/31/stages",
      "/api/v1/deals",
      "/api/v1/deals/403",
      "/api/v1/tasks"
    ].map((url) => app.inject({ method, url, headers: authorization, payload: {} })));

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("not_found");
    }
  });
});

describe("pipeline read API multi-tenant isolation", () => {
  const foreign = { authorization: `Bearer ${foreignKey}` };

  it.each([
    ["/api/v1/pipelines/31/stages", "pipeline_not_found"],
    ["/api/v1/deals/403", "deal_not_found"]
  ])("refuses %s when the ID belongs to another company", async (url, code) => {
    const response = await get(url, foreign);

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe(code);
  });

  it.each([
    "/api/v1/pipelines",
    "/api/v1/deals",
    "/api/v1/deals?pipeline_id=31",
    "/api/v1/deals?contact_id=101",
    "/api/v1/tasks",
    "/api/v1/tasks?contact_id=101"
  ])("never leaks the caller's records to another company on %s", async (url) => {
    const response = await get(url, foreign);

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("Renovación anual");
    expect(response.body).not.toContain("Propuesta enviada");
    expect(response.body).not.toContain("Equipo comercial");
  });
});
