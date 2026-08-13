import type pg from "pg";

import {
  cursorParameters,
  iso,
  paged,
  type PageQuery,
  type ResourcePage,
  type Timestamp
} from "./core.js";

export interface IncrementalQuery extends PageQuery {
  updatedSince: string | null;
}

export interface DealQuery extends IncrementalQuery {
  pipelineId: number | null;
  contactId: number | null;
}

export interface TaskQuery extends IncrementalQuery {
  contactId: number | null;
}

export interface PipelineResource {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  is_default: boolean;
  is_template: boolean;
  template_category: string | null;
  order_num: number;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineStageResource {
  id: string;
  pipeline_id: string;
  name: string;
  color: string;
  order_num: number;
  created_at: string;
  updated_at: string;
}

/**
 * `stage_key` y `stage_id`/`stage_name` son dos vocabularios paralelos: el texto
 * heredado del CRM y la etapa configurable. Nunca coinciden en los datos reales,
 * asi que se exponen por separado y sin derivar uno del otro.
 */
export interface DealResource {
  id: string;
  pipeline_id: string;
  contact_id: string;
  title: string;
  stage_key: string;
  stage_id: string | null;
  stage_name: string | null;
  value: number | null;
  priority: string | null;
  status: string | null;
  due_date: string | null;
  assigned_to_user_id: string | null;
  description: string | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskResource {
  id: string;
  contact_id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  /** Texto libre en el esquema: no es una referencia a un usuario. */
  assigned_to: string | null;
  category: string | null;
  tags: string[];
  background_color: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineRepository {
  listPipelines(companyId: number, query: IncrementalQuery): Promise<ResourcePage<PipelineResource>>;
  listStages(
    companyId: number,
    pipelineId: number,
    query: IncrementalQuery
  ): Promise<ResourcePage<PipelineStageResource> | null>;
  listDeals(companyId: number, query: DealQuery): Promise<ResourcePage<DealResource>>;
  findDeal(companyId: number, dealId: number): Promise<DealResource | null>;
  listTasks(companyId: number, query: TaskQuery): Promise<ResourcePage<TaskResource>>;
}

interface PipelineRow {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  is_default: boolean | null;
  is_template: boolean | null;
  template_category: string | null;
  order_num: number;
  created_by: number | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

interface PipelineStageRow {
  id: number;
  pipeline_id: number;
  name: string;
  color: string;
  order_num: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

interface DealRow {
  id: number;
  pipeline_id: number;
  contact_id: number;
  title: string;
  stage: string;
  stage_id: number | null;
  stage_name: string | null;
  value: number | null;
  priority: string | null;
  status: string | null;
  due_date: Timestamp;
  assigned_to_user_id: number | null;
  description: string | null;
  tags: string[] | null;
  custom_fields: Record<string, unknown> | null;
  last_activity_at: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

interface TaskRow {
  id: number;
  contact_id: number;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  due_date: Timestamp;
  completed_at: Timestamp;
  assigned_to: string | null;
  category: string | null;
  tags: string[] | null;
  background_color: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

const reference = (value: number | null): string | null => value === null ? null : String(value);

const DEAL_COLUMNS = `deals.id, deals.pipeline_id, deals.contact_id, deals.title,
              deals.stage, deals.stage_id, pipeline_stages.name AS stage_name,
              deals.value, deals.priority, deals.status, deals.due_date,
              deals.assigned_to_user_id, deals.description, deals.tags,
              deals.custom_fields, deals.last_activity_at, deals.created_at, deals.updated_at`;

/**
 * La etapa solo se resuelve dentro del mismo pipeline y empresa: una referencia
 * colgante devuelve `stage_name` nulo en lugar del nombre de una etapa ajena.
 */
const DEAL_SOURCE = `deals
         LEFT JOIN pipeline_stages
                ON pipeline_stages.id = deals.stage_id
               AND pipeline_stages.pipeline_id = deals.pipeline_id
               AND pipeline_stages.company_id = deals.company_id`;

function dealResource(row: DealRow): DealResource {
  return {
    id: String(row.id),
    pipeline_id: String(row.pipeline_id),
    contact_id: String(row.contact_id),
    title: row.title,
    stage_key: row.stage,
    stage_id: reference(row.stage_id),
    stage_name: row.stage_name,
    value: row.value,
    priority: row.priority,
    status: row.status,
    due_date: iso(row.due_date),
    assigned_to_user_id: reference(row.assigned_to_user_id),
    description: row.description,
    tags: row.tags ?? [],
    custom_fields: row.custom_fields ?? {},
    last_activity_at: iso(row.last_activity_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!
  };
}

export class PostgresPipelineRepository implements PipelineRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listPipelines(companyId: number, query: IncrementalQuery): Promise<ResourcePage<PipelineResource>> {
    const [cursorDate, cursorId] = cursorParameters(query);
    // company_id es NULL-able para plantillas globales: el filtro es estricto a
    // proposito, nunca `OR company_id IS NULL`.
    const result = await this.pool.query<PipelineRow>(
      `SELECT id, name, description, icon, color, is_default, is_template,
              template_category, order_num, created_by, created_at, updated_at
         FROM pipelines
        WHERE company_id = $1
          AND ($2::timestamp IS NULL OR updated_at >= $2::timestamp)
          AND ($3::timestamp IS NULL OR (created_at, id) < ($3::timestamp, $4::integer))
        ORDER BY created_at DESC, id DESC
        LIMIT $5`,
      [companyId, query.updatedSince, cursorDate, cursorId, query.limit + 1]
    );
    return paged(result.rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      description: row.description,
      icon: row.icon,
      color: row.color,
      is_default: row.is_default ?? false,
      is_template: row.is_template ?? false,
      template_category: row.template_category,
      order_num: row.order_num,
      created_by_user_id: reference(row.created_by),
      created_at: iso(row.created_at)!,
      updated_at: iso(row.updated_at)!
    })), query.limit);
  }

  async listStages(
    companyId: number,
    pipelineId: number,
    query: IncrementalQuery
  ): Promise<ResourcePage<PipelineStageResource> | null> {
    const pipeline = await this.pool.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pipelines WHERE id = $1 AND company_id = $2) AS exists",
      [pipelineId, companyId]
    );
    if (pipeline.rows[0]?.exists !== true) return null;

    const [cursorDate, cursorId] = cursorParameters(query);
    // La etapa debe pertenecer a la vez al pipeline y a la empresa: comprobar
    // solo una de las dos columnas permitiria confundir IDs entre empresas.
    const result = await this.pool.query<PipelineStageRow>(
      `SELECT pipeline_stages.id, pipeline_stages.pipeline_id, pipeline_stages.name,
              pipeline_stages.color, pipeline_stages.order_num,
              pipeline_stages.created_at, pipeline_stages.updated_at
         FROM pipeline_stages
         JOIN pipelines ON pipelines.id = pipeline_stages.pipeline_id
        WHERE pipeline_stages.pipeline_id = $1
          AND pipeline_stages.company_id = $2
          AND pipelines.company_id = $2
          AND ($3::timestamp IS NULL OR pipeline_stages.updated_at >= $3::timestamp)
          AND ($4::timestamp IS NULL
               OR (pipeline_stages.created_at, pipeline_stages.id) < ($4::timestamp, $5::integer))
        ORDER BY pipeline_stages.created_at DESC, pipeline_stages.id DESC
        LIMIT $6`,
      [pipelineId, companyId, query.updatedSince, cursorDate, cursorId, query.limit + 1]
    );
    return paged(result.rows.map((row) => ({
      id: String(row.id),
      pipeline_id: String(row.pipeline_id),
      name: row.name,
      color: row.color,
      order_num: row.order_num,
      created_at: iso(row.created_at)!,
      updated_at: iso(row.updated_at)!
    })), query.limit);
  }

  async listDeals(companyId: number, query: DealQuery): Promise<ResourcePage<DealResource>> {
    const [cursorDate, cursorId] = cursorParameters(query);
    const result = await this.pool.query<DealRow>(
      `SELECT ${DEAL_COLUMNS}
         FROM ${DEAL_SOURCE}
        WHERE deals.company_id = $1
          AND ($2::integer IS NULL OR deals.pipeline_id = $2::integer)
          AND ($3::integer IS NULL OR deals.contact_id = $3::integer)
          AND ($4::timestamp IS NULL OR deals.updated_at >= $4::timestamp)
          AND ($5::timestamp IS NULL OR (deals.created_at, deals.id) < ($5::timestamp, $6::integer))
        ORDER BY deals.created_at DESC, deals.id DESC
        LIMIT $7`,
      [
        companyId,
        query.pipelineId,
        query.contactId,
        query.updatedSince,
        cursorDate,
        cursorId,
        query.limit + 1
      ]
    );
    return paged(result.rows.map(dealResource), query.limit);
  }

  async findDeal(companyId: number, dealId: number): Promise<DealResource | null> {
    const result = await this.pool.query<DealRow>(
      `SELECT ${DEAL_COLUMNS}
         FROM ${DEAL_SOURCE}
        WHERE deals.company_id = $1
          AND deals.id = $2`,
      [companyId, dealId]
    );
    const row = result.rows[0];
    return row === undefined ? null : dealResource(row);
  }

  async listTasks(companyId: number, query: TaskQuery): Promise<ResourcePage<TaskResource>> {
    const [cursorDate, cursorId] = cursorParameters(query);
    const result = await this.pool.query<TaskRow>(
      `SELECT id, contact_id, title, description, priority, status, due_date, completed_at,
              assigned_to, category, tags, background_color, created_by, updated_by,
              created_at, updated_at
         FROM contact_tasks
        WHERE company_id = $1
          AND ($2::integer IS NULL OR contact_id = $2::integer)
          AND ($3::timestamp IS NULL OR updated_at >= $3::timestamp)
          AND ($4::timestamp IS NULL OR (created_at, id) < ($4::timestamp, $5::integer))
        ORDER BY created_at DESC, id DESC
        LIMIT $6`,
      [companyId, query.contactId, query.updatedSince, cursorDate, cursorId, query.limit + 1]
    );
    return paged(result.rows.map((row) => ({
      id: String(row.id),
      contact_id: String(row.contact_id),
      title: row.title,
      description: row.description,
      priority: row.priority,
      status: row.status,
      due_date: iso(row.due_date),
      completed_at: iso(row.completed_at),
      assigned_to: row.assigned_to,
      category: row.category,
      tags: row.tags ?? [],
      background_color: row.background_color,
      created_by_user_id: reference(row.created_by),
      updated_by_user_id: reference(row.updated_by),
      created_at: iso(row.created_at)!,
      updated_at: iso(row.updated_at)!
    })), query.limit);
  }
}
