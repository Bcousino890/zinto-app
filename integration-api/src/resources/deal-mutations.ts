import type pg from "pg";
import { DEAL_OWN_COLUMNS, dealResource, type DealResource, type DealRow } from "./pipelines.js";
import { mapPipelineStageToEnum } from "./pipeline-mutations.js";

export interface DealCreateInput {
  contact_id: string;
  pipeline_id: string;
  stage_id: string;
  title: string;
  value?: number | null;
  priority?: string | null;
  status?: string | null;
  due_date?: string | null;
  assigned_to_user_id?: string | null;
  description?: string | null;
  tags?: string[];
  custom_fields?: Record<string, unknown>;
}
export type DealUpdateInput = Partial<Omit<DealCreateInput, "contact_id" | "pipeline_id" | "stage_id">> & { stage_id?: string | null };

export type DealMutationFailure = "contact_not_found" | "pipeline_not_found" | "stage_not_found" | "deal_not_found" | "duplicate_active_deal";
export type DealMutationResult = { ok: true; deal: DealResource } | { ok: false; reason: DealMutationFailure };

export interface DealMutationRepository {
  createDeal(companyId: number, userId: number, input: DealCreateInput): Promise<DealMutationResult>;
  updateDeal(companyId: number, dealId: number, userId: number, input: DealUpdateInput): Promise<DealMutationResult>;
  deleteDeal(companyId: number, dealId: number, userId: number): Promise<DealMutationResult>;
  moveDeal(companyId: number, dealId: number, userId: number, pipelineId: number, stageId: number): Promise<DealMutationResult>;
}

type DealWriteRow = Omit<DealRow, "stage_name">;
const ownColumns = DEAL_OWN_COLUMNS.replaceAll("deals.", "");

export class PostgresDealMutationRepository implements DealMutationRepository {
  constructor(private readonly pool: pg.Pool) {}

  private async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); await client.query("SELECT set_config('zinto.integration_api_origin','api',true)"); const value = await fn(client); await client.query("COMMIT"); return value; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  private async record(client: pg.PoolClient, companyId: number, userId: number, event: string, id: number, value: unknown): Promise<void> {
    const payload = JSON.stringify(value);
    await client.query("INSERT INTO integration_api_audit_records (company_id,actor_user_id,action,resource_type,resource_id,new_values) VALUES ($1,$2,$3,'deal',$4,$5::jsonb)", [companyId, userId, event, id, payload]);
    await client.query("INSERT INTO integration_api_outbox (company_id,event_type,resource_type,resource_id,payload) VALUES ($1,$2,'deal',$3,$4::jsonb)", [companyId, event, id, payload]);
  }

  private async resource(client: pg.PoolClient, companyId: number, id: number): Promise<DealResource | null> {
    const result = await client.query<DealWriteRow & { stage_name: string | null }>(
      `SELECT ${DEAL_OWN_COLUMNS}, pipeline_stages.name AS stage_name
         FROM deals LEFT JOIN pipeline_stages ON pipeline_stages.id=deals.stage_id
          AND pipeline_stages.pipeline_id=deals.pipeline_id AND pipeline_stages.company_id=deals.company_id
        WHERE deals.id=$1 AND deals.company_id=$2`, [id, companyId]);
    return result.rows[0] ? dealResource(result.rows[0]) : null;
  }

  private async stage(client: pg.PoolClient, companyId: number, pipelineId: number, stageId: number): Promise<{ name: string } | null> {
    const result = await client.query<{ name: string }>("SELECT name FROM pipeline_stages WHERE id=$1 AND pipeline_id=$2 AND company_id=$3", [stageId, pipelineId, companyId]);
    return result.rows[0] ?? null;
  }

  async createDeal(companyId: number, userId: number, input: DealCreateInput): Promise<DealMutationResult> {
    return this.tx(async (client) => {
      const contact = await client.query("SELECT id FROM contacts WHERE id=$1 AND company_id=$2 AND is_archived=false", [Number(input.contact_id), companyId]);
      if (!contact.rows[0]) return { ok: false, reason: "contact_not_found" };
      const pipeline = await client.query("SELECT id FROM pipelines WHERE id=$1 AND company_id=$2", [Number(input.pipeline_id), companyId]);
      if (!pipeline.rows[0]) return { ok: false, reason: "pipeline_not_found" };
      const stage = await this.stage(client, companyId, Number(input.pipeline_id), Number(input.stage_id));
      if (!stage) return { ok: false, reason: "stage_not_found" };
      try {
        const result = await client.query<DealWriteRow>(
          `INSERT INTO deals (company_id,contact_id,pipeline_id,title,stage_id,stage,value,priority,status,due_date,assigned_to_user_id,description,tags,custom_fields)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'active'),$10::timestamp,$11,$12,$13::text[],$14::jsonb)
           RETURNING ${DEAL_OWN_COLUMNS}`,
          [companyId, Number(input.contact_id), Number(input.pipeline_id), input.title, Number(input.stage_id), mapPipelineStageToEnum(stage.name), input.value ?? null, input.priority ?? null, input.status ?? null, input.due_date ?? null, input.assigned_to_user_id ? Number(input.assigned_to_user_id) : null, input.description ?? null, input.tags ?? [], JSON.stringify(input.custom_fields ?? {})]);
        const row = result.rows[0]!;
        const value = dealResource({ ...row, stage_name: stage.name });
        await this.record(client, companyId, userId, "deal.created", row.id, value);
        return { ok: true, deal: value };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") return { ok: false, reason: "duplicate_active_deal" };
        throw error;
      }
    });
  }

  async updateDeal(companyId: number, dealId: number, userId: number, input: DealUpdateInput): Promise<DealMutationResult> {
    return this.tx(async (client) => {
      const current = await client.query<{ pipeline_id: number; stage_id: number | null }>("SELECT pipeline_id,stage_id FROM deals WHERE id=$1 AND company_id=$2", [dealId, companyId]);
      if (!current.rows[0]) return { ok: false, reason: "deal_not_found" };
      let stageName: string | null = null;
      let stageId = current.rows[0].stage_id;
      if (input.stage_id !== undefined) {
        if (input.stage_id === null) return { ok: false, reason: "stage_not_found" };
        const stage = await this.stage(client, companyId, current.rows[0].pipeline_id, Number(input.stage_id));
        if (!stage) return { ok: false, reason: "stage_not_found" };
        stageId = Number(input.stage_id); stageName = stage.name;
      } else if (stageId !== null) {
        const stage = await this.stage(client, companyId, current.rows[0].pipeline_id, stageId);
        stageName = stage?.name ?? null;
      }
      const result = await client.query<DealWriteRow>(
        `UPDATE deals SET title=CASE WHEN $3 THEN $4 ELSE title END,value=CASE WHEN $5 THEN $6 ELSE value END,priority=CASE WHEN $7 THEN $8 ELSE priority END,status=CASE WHEN $9 THEN $10 ELSE status END,due_date=CASE WHEN $11 THEN $12::timestamp ELSE due_date END,assigned_to_user_id=CASE WHEN $13 THEN $14 ELSE assigned_to_user_id END,description=CASE WHEN $15 THEN $16 ELSE description END,tags=CASE WHEN $17 THEN $18::text[] ELSE tags END,custom_fields=CASE WHEN $19 THEN $20::jsonb ELSE custom_fields END,stage_id=CASE WHEN $21 THEN $22 ELSE stage_id END,stage=CASE WHEN $21 THEN $23 ELSE stage END,updated_at=now(),last_activity_at=now() WHERE id=$1 AND company_id=$2 RETURNING ${DEAL_OWN_COLUMNS}`,
        [dealId, companyId, "title" in input, input.title ?? null, "value" in input, input.value ?? null, "priority" in input, input.priority ?? null, "status" in input, input.status ?? null, "due_date" in input, input.due_date ?? null, "assigned_to_user_id" in input, input.assigned_to_user_id ? Number(input.assigned_to_user_id) : null, "description" in input, input.description ?? null, "tags" in input, input.tags ?? null, "custom_fields" in input, JSON.stringify(input.custom_fields ?? {}), input.stage_id !== undefined, stageId, stageName ? mapPipelineStageToEnum(stageName) : "lead"]);
      if (!result.rows[0]) return { ok: false, reason: "deal_not_found" };
      const value = dealResource({ ...result.rows[0], stage_name: stageName });
      await this.record(client, companyId, userId, "deal.updated", dealId, value);
      return { ok: true, deal: value };
    });
  }

  async deleteDeal(companyId: number, dealId: number, userId: number): Promise<DealMutationResult> {
    return this.tx(async (client) => {
      const result = await client.query<DealWriteRow>("DELETE FROM deals WHERE id=$1 AND company_id=$2 RETURNING " + ownColumns, [dealId, companyId]);
      if (!result.rows[0]) return { ok: false, reason: "deal_not_found" };
      const value = dealResource({ ...result.rows[0], stage_name: null });
      await this.record(client, companyId, userId, "deal.deleted", dealId, value);
      return { ok: true, deal: value };
    });
  }

  async moveDeal(companyId: number, dealId: number, userId: number, pipelineId: number, stageId: number): Promise<DealMutationResult> {
    return this.tx(async (client) => {
      const deal = await client.query("SELECT id FROM deals WHERE id=$1 AND company_id=$2", [dealId, companyId]);
      if (!deal.rows[0]) return { ok: false, reason: "deal_not_found" };
      const pipeline = await client.query("SELECT id FROM pipelines WHERE id=$1 AND company_id=$2", [pipelineId, companyId]);
      if (!pipeline.rows[0]) return { ok: false, reason: "pipeline_not_found" };
      const stage = await this.stage(client, companyId, pipelineId, stageId);
      if (!stage) return { ok: false, reason: "stage_not_found" };
      try {
        const updated = await client.query<DealWriteRow>("UPDATE deals SET pipeline_id=$3,stage_id=$4,stage=$5,updated_at=now(),last_activity_at=now() WHERE id=$1 AND company_id=$2 RETURNING " + ownColumns, [dealId, companyId, pipelineId, stageId, mapPipelineStageToEnum(stage.name)]);
        const value = dealResource({ ...updated.rows[0]!, stage_name: stage.name });
        await this.record(client, companyId, userId, "deal.pipeline_moved", dealId, value);
        return { ok: true, deal: value };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") return { ok: false, reason: "duplicate_active_deal" };
        throw error;
      }
    });
  }
}
