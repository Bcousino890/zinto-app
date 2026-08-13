import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";
import {
  mapPipelineStageToEnum,
  type DealStageChangeResult,
  type PipelineMutationRepository
} from "../src/resources/pipeline-mutations.js";
import type { DealResource } from "../src/resources/pipelines.js";

const CALLER = 12;
const OWNER = 77;

const rawKey = `pcp_${"c".repeat(64)}`;
const keyHash = createHash("sha256").update(rawKey.slice(4)).digest("hex");
const narrowKey = `pcp_${"d".repeat(64)}`;
const narrowHash = createHash("sha256").update(narrowKey.slice(4)).digest("hex");

const authorization = { authorization: `Bearer ${rawKey}` };
const narrowAuthorization = { authorization: `Bearer ${narrowKey}` };
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

const keys: ApiKeyRecord[] = [
  {
    id: 8,
    companyId: CALLER,
    companyName: "Empresa que llama",
    userId: 4,
    name: "Partner integration",
    keyHash,
    permissions: ["deals:read", "deals:write"],
    isActive: true,
    expiresAt: null,
    allowedIps: []
  },
  {
    id: 9,
    companyId: CALLER,
    companyName: "Empresa que llama",
    userId: 4,
    name: "Clave de solo lectura",
    keyHash: narrowHash,
    permissions: ["deals:read"],
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

interface OwnedDeal {
  companyId: number;
  id: number;
  pipelineId: number;
  stageId: number | null;
  resource: DealResource;
}

interface OwnedStage {
  companyId: number;
  id: number;
  pipelineId: number;
  name: string;
}

const stages: OwnedStage[] = [
  { companyId: CALLER, id: 310, pipelineId: 31, name: "Contacto inicial" },
  { companyId: CALLER, id: 311, pipelineId: 31, name: "Envio prop" },
  { companyId: CALLER, id: 320, pipelineId: 32, name: "Ticket abierto" },
  { companyId: OWNER, id: 800, pipelineId: 80, name: "Etapa de otra empresa" }
];

function dealFixture(companyId: number, id: number, pipelineId: number, stageId: number): OwnedDeal {
  const stage = stages.find((item) => item.id === stageId)!;
  return {
    companyId,
    id,
    pipelineId,
    stageId,
    resource: {
      id: String(id),
      pipeline_id: String(pipelineId),
      contact_id: "101",
      title: companyId === OWNER ? "Negocio confidencial de otra empresa" : "Renovación anual",
      stage_key: "lead",
      stage_id: String(stageId),
      stage_name: stage.name,
      value: 120_000,
      priority: "high",
      status: "open",
      due_date: null,
      assigned_to_user_id: "9",
      description: null,
      tags: [],
      custom_fields: {},
      last_activity_at: null,
      created_at: "2026-08-12T09:00:00.000Z",
      updated_at: "2026-08-12T09:00:00.000Z"
    }
  };
}

/**
 * Doble en memoria con las mismas reglas que el repositorio real: empresa
 * primero, etapa despues y desajuste de pipeline como error.
 */
class MemoryPipelineMutations implements PipelineMutationRepository {
  calls: Array<{ companyId: number; dealId: number; userId: number; stageId: number }> = [];
  deals: OwnedDeal[] = [
    dealFixture(CALLER, 403, 31, 310),
    dealFixture(OWNER, 900, 80, 800)
  ];

  async changeDealStage(
    companyId: number,
    dealId: number,
    userId: number,
    stageId: number
  ): Promise<DealStageChangeResult> {
    this.calls.push({ companyId, dealId, userId, stageId });
    const deal = this.deals.find((item) => item.companyId === companyId && item.id === dealId);
    if (deal === undefined) return { ok: false, reason: "deal_not_found" };
    const stage = stages.find((item) => item.companyId === companyId && item.id === stageId);
    if (stage === undefined) return { ok: false, reason: "stage_not_found" };
    if (stage.pipelineId !== deal.pipelineId) return { ok: false, reason: "pipeline_mismatch" };

    deal.stageId = stage.id;
    deal.resource = {
      ...deal.resource,
      stage_key: mapPipelineStageToEnum(stage.name),
      stage_id: String(stage.id),
      stage_name: stage.name,
      last_activity_at: "2026-08-13T15:00:00.000Z",
      updated_at: "2026-08-13T15:00:00.000Z"
    };
    return { ok: true, deal: deal.resource };
  }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp() {
  const repository = new MemoryPipelineMutations();
  const app = await buildApp({
    apiKeyRepository: new MemoryApiKeys(),
    pipelineMutationRepository: repository,
    logger: false,
    readOnly: false
  });
  apps.push(app);
  return { app, repository };
}

async function patch(
  url: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = authorization
) {
  const { app, repository } = await makeApp();
  const response = await app.inject({ method: "PATCH", url, headers, payload });
  return { response, repository };
}

describe("deal stage change API", () => {
  it("moves a deal to another stage of its own pipeline", async () => {
    const { response, repository } = await patch("/api/v1/deals/403/stage", { stage_id: "311" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(expect.objectContaining({
      id: "403",
      stage_id: "311",
      stage_name: "Envio prop",
      // El mapeador heredado colapsa "Envio prop" a `lead`: el texto y la etapa
      // configurable siguen siendo vocabularios distintos.
      stage_key: "lead"
    }));
    expect(response.json().meta.request_id).toMatch(/^req_/);
    expect(repository.calls).toEqual([{ companyId: 12, dealId: 403, userId: 4, stageId: 311 }]);
  });

  it("attributes the change to the user behind the API key", async () => {
    const { repository } = await patch("/api/v1/deals/403/stage", { stage_id: "311" });

    // Nunca el respaldo `assigned_to_user_id || 1` del motor legacy.
    expect(repository.calls[0]!.userId).toBe(4);
    expect(repository.calls[0]!.userId).not.toBe(1);
  });

  it("returns 404 for a deal that does not exist", async () => {
    const { response } = await patch("/api/v1/deals/404404/stage", { stage_id: "311" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("deal_not_found");
  });

  it("hides a deal of another company behind the same 404", async () => {
    const { response, repository } = await patch("/api/v1/deals/900/stage", { stage_id: "311" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("deal_not_found");
    expect(response.body).not.toContain("confidencial");
    expect(response.body).not.toContain("Etapa de otra empresa");
    // El deal ajeno queda intacto: la peticion nunca llega a escribir.
    expect(repository.deals.find((item) => item.id === 900)!.stageId).toBe(800);
  });

  it("returns 404 for a stage that does not exist", async () => {
    const { response } = await patch("/api/v1/deals/403/stage", { stage_id: "999999" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("stage_not_found");
  });

  it("returns 404 for a stage owned by another company", async () => {
    const { response, repository } = await patch("/api/v1/deals/403/stage", { stage_id: "800" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("stage_not_found");
    expect(response.body).not.toContain("Etapa de otra empresa");
    expect(repository.deals.find((item) => item.id === 403)!.stageId).toBe(310);
  });

  it("returns 422 when the stage belongs to a different pipeline", async () => {
    const { response, repository } = await patch("/api/v1/deals/403/stage", { stage_id: "320" });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("stage_pipeline_mismatch");
    // Cambiar de pipeline es otra operacion: el deal no se mueve.
    expect(repository.deals.find((item) => item.id === 403)!.stageId).toBe(310);
  });

  it("rejects a body without a usable stage_id", async () => {
    const payloads: Record<string, unknown>[] = [
      {},
      { stage_id: "" },
      { stage_id: "abc" },
      { stage_id: "31 1" },
      { stage_id: 311 },
      { stage_id: null }
    ];
    for (const payload of payloads) {
      const { response, repository } = await patch("/api/v1/deals/403/stage", payload);

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("validation_error");
      expect(repository.calls).toEqual([]);
    }
  });

  it("rejects unknown body fields instead of ignoring them", async () => {
    const { response, repository } = await patch("/api/v1/deals/403/stage", {
      stage_id: "311",
      pipeline_id: "32",
      company_id: 77
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
    expect(repository.calls).toEqual([]);
  });

  it("rejects a non numeric deal ID", async () => {
    const { response, repository } = await patch("/api/v1/deals/abc/stage", { stage_id: "311" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
    expect(repository.calls).toEqual([]);
  });

  it("requires the deals:write scope", async () => {
    const { response, repository } = await patch(
      "/api/v1/deals/403/stage",
      { stage_id: "311" },
      narrowAuthorization
    );

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("insufficient_scope");
    expect(repository.calls).toEqual([]);
  });

  it("requires an API key at all", async () => {
    const { response, repository } = await patch("/api/v1/deals/403/stage", { stage_id: "311" }, {});

    expect(response.statusCode).toBe(401);
    expect(repository.calls).toEqual([]);
  });

  it("stays disabled while the service runs in read-only mode", async () => {
    const app = await buildApp({
      apiKeyRepository: new MemoryApiKeys(),
      pipelineMutationRepository: new MemoryPipelineMutations(),
      logger: false,
      readOnly: true
    });
    apps.push(app);

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/deals/403/stage",
      headers: authorization,
      payload: { stage_id: "311" }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("read_only_mode");
  });
});
