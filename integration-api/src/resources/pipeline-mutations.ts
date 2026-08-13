import type pg from "pg";

import {
  DEAL_OWN_COLUMNS,
  dealResource,
  type DealResource,
  type DealRow
} from "./pipelines.js";

/** Vocabulario heredado de la columna de texto `deals.stage`. */
export type DealStageKey =
  | "lead"
  | "qualified"
  | "contacted"
  | "demo_scheduled"
  | "proposal"
  | "negotiation"
  | "closed_won"
  | "closed_lost";

export type DealStageChangeFailure = "deal_not_found" | "stage_not_found" | "pipeline_mismatch";

/**
 * Tres finales distintos se traducen a tres respuestas distintas, asi que el
 * repositorio devuelve un resultado discriminado en vez del `null` que usan las
 * operaciones con un unico motivo de fallo.
 */
export type DealStageChangeResult =
  | { ok: true; deal: DealResource }
  | { ok: false; reason: DealStageChangeFailure };

export interface PipelineMutationRepository {
  changeDealStage(
    companyId: number,
    dealId: number,
    userId: number,
    stageId: number
  ): Promise<DealStageChangeResult>;
}

/**
 * Replica literal de `storage.mapPipelineStageToEnum` del CRM compilado
 * (bundle de produccion, offset ~2211100), incluido el orden de comprobaciones.
 *
 * Ese orden tiene un fallo conocido: `"closed"` se comprueba antes que
 * `"lost"`, de modo que una etapa llamada "Closed Lost" se registra como
 * `closed_won`. **No se corrige a proposito**: nuestras escrituras tienen que
 * ser indistinguibles de las del motor. Si algun dia se arregla la inversion,
 * hay que arreglarla en el motor y aqui a la vez, nunca solo en un lado.
 * Detalle completo en `docs/api/LEGACY-ENGINE-AUDIT-2026-08-13.md`, pregunta 2.
 */
export function mapPipelineStageToEnum(name: string): DealStageKey {
  const value = name.toLowerCase();
  if (value.includes("lead") || value.includes("new")) return "lead";
  if (value.includes("qualified") || value.includes("qualify")) return "qualified";
  if (value.includes("contact") || value.includes("reach")) return "contacted";
  if (value.includes("demo") || value.includes("presentation")) return "demo_scheduled";
  if (value.includes("proposal") || value.includes("quote")) return "proposal";
  if (value.includes("negotiat") || value.includes("discuss")) return "negotiation";
  if (value.includes("won") || value.includes("closed") || value.includes("success")) return "closed_won";
  if (value.includes("lost") || value.includes("reject")) return "closed_lost";
  return "lead";
}

interface DealStageRow {
  id: number;
  pipeline_id: number;
  stage_id: number | null;
}

interface PipelineStageRow {
  id: number;
  pipeline_id: number;
  name: string;
}

export class PostgresPipelineMutationRepository implements PipelineMutationRepository {
  constructor(private readonly pool: pg.Pool) {}

  private async transaction<T>(operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('zinto.integration_api_origin', 'api', true)");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async record(
    client: pg.PoolClient,
    companyId: number,
    userId: number | null,
    eventType: string,
    resourceType: string,
    resourceId: number,
    payload: unknown
  ): Promise<void> {
    await client.query(
      `INSERT INTO integration_api_audit_records
         (company_id, actor_user_id, action, resource_type, resource_id, new_values)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [companyId, userId, eventType, resourceType, resourceId, JSON.stringify(payload)]
    );
    await client.query(
      `INSERT INTO integration_api_outbox
         (company_id, event_type, resource_type, resource_id, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [companyId, eventType, resourceType, resourceId, JSON.stringify(payload)]
    );
  }

  /**
   * Replica `storage.updateDealStageId` del motor: valida que la etapa destino
   * pertenece al mismo pipeline del deal, escribe `stage_id` y `stage` juntas y
   * deja rastro en `deal_activities`. Mover un deal entre pipelines es otra
   * operacion del motor (`updateDealPipelineAndStage`) y aqui es un error.
   */
  async changeDealStage(
    companyId: number,
    dealId: number,
    userId: number,
    stageId: number
  ): Promise<DealStageChangeResult> {
    return this.transaction(async (client) => {
      const deals = await client.query<DealStageRow>(
        `SELECT id, pipeline_id, stage_id
           FROM deals
          WHERE id = $1 AND company_id = $2`,
        [dealId, companyId]
      );
      const deal = deals.rows[0];
      if (deal === undefined) return { ok: false, reason: "deal_not_found" };

      // La etapa se busca por empresa ademas de por id, y se comprueba tambien
      // la empresa del pipeline: `company_id` es NULL-able en ambas tablas y un
      // filtro laxo dejaria pasar plantillas globales de otra empresa.
      const stages = await client.query<PipelineStageRow>(
        `SELECT pipeline_stages.id, pipeline_stages.pipeline_id, pipeline_stages.name
           FROM pipeline_stages
           JOIN pipelines ON pipelines.id = pipeline_stages.pipeline_id
          WHERE pipeline_stages.id = $1
            AND pipeline_stages.company_id = $2
            AND pipelines.company_id = $2`,
        [stageId, companyId]
      );
      const stage = stages.rows[0];
      if (stage === undefined) return { ok: false, reason: "stage_not_found" };
      if (stage.pipeline_id !== deal.pipeline_id) return { ok: false, reason: "pipeline_mismatch" };

      // Las dos columnas de etapa se escriben siempre juntas: escribir `stage`
      // sin `stage_id` es lo unico capaz de desincronizarlas todavia mas.
      const updated = await client.query<Omit<DealRow, "stage_name">>(
        `UPDATE deals
            SET stage_id = $3,
                stage = $4,
                updated_at = now(),
                last_activity_at = now()
          WHERE id = $1 AND company_id = $2
          RETURNING ${DEAL_OWN_COLUMNS}`,
        [dealId, companyId, stageId, mapPipelineStageToEnum(stage.name)]
      );
      const row = updated.rows[0];
      // Carrera con un borrado entre la lectura y la escritura: sin fila
      // afectada no hay nada que auditar y la ruta responde 404.
      if (row === undefined) return { ok: false, reason: "deal_not_found" };

      // `deal_activities` es una tabla heredada del CRM: no la crea ni la migra
      // este proyecto. RIESGO ABIERTO: la auditoria solo documento estas seis
      // columnas, asi que este INSERT las asume suficientes. Si el esquema real
      // tuviera otra columna NOT NULL sin valor por defecto, este INSERT
      // fallaria en produccion. Verificar contra el esquema real antes de
      // habilitar escrituras (no se pudo comprobar: sin acceso a la base).
      await client.query(
        `INSERT INTO deal_activities (deal_id, user_id, type, content, metadata, created_at)
         VALUES ($1, $2, 'stage_change', 'Deal moved to ' || $3 || ' stage', $4::jsonb, now())`,
        [
          dealId,
          // El motor usa `assigned_to_user_id || 1`; aqui el autor es el usuario
          // real de la API key, que es lo unico que si esta en nuestra mano.
          userId,
          stage.name,
          JSON.stringify({
            previousStageId: deal.stage_id === null ? null : String(deal.stage_id),
            newStageId: String(stageId),
            pipelineId: String(deal.pipeline_id)
          })
        ]
      );

      const resource = dealResource({ ...row, stage_name: stage.name });
      await this.record(
        client,
        companyId,
        userId,
        "deal.stage.changed",
        "deal",
        dealId,
        resource
      );
      return { ok: true, deal: resource };
    });
  }
}
