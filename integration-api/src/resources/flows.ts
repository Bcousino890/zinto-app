import type pg from "pg";

import { cursorParameters, iso, paged, type IncrementalQuery, type ResourcePage, type Timestamp } from "./core.js";

export interface FlowExecutionQuery extends IncrementalQuery {
  flowId: number | null;
  status: string | null;
}

export interface FlowResource {
  id: string;
  created_by_user_id: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface FlowAssignmentResource {
  id: string;
  flow_id: string;
  channel_id: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FlowExecutionResource {
  id: string;
  run_id: string;
  flow_id: string;
  conversation_id: string;
  contact_id: string;
  status: string;
  trigger_node_id: string;
  current_node_id: string | null;
  runtime_type: string;
  started_at: string;
  completed_at: string | null;
  last_activity_at: string;
  total_duration_ms: number | null;
  completion_rate: string | null;
  created_at: string;
  updated_at: string;
}

export interface FlowRepository {
  listFlows(companyId: number, query: IncrementalQuery): Promise<ResourcePage<FlowResource>>;
  findFlow(companyId: number, flowId: number): Promise<FlowResource | null>;
  listAssignments(companyId: number, flowId: number, query: IncrementalQuery): Promise<ResourcePage<FlowAssignmentResource> | null>;
  listExecutions(companyId: number, query: FlowExecutionQuery): Promise<ResourcePage<FlowExecutionResource>>;
}

interface FlowRow {
  id: number; user_id: number; name: string; description: string | null; status: string;
  version: number; created_at: Timestamp; updated_at: Timestamp;
}

interface AssignmentRow {
  id: number; flow_id: number; channel_id: number; is_active: boolean;
  created_at: Timestamp; updated_at: Timestamp;
}

interface ExecutionRow {
  id: number; run_id: string; flow_id: number; conversation_id: number; contact_id: number;
  status: string; trigger_node_id: string; current_node_id: string | null; runtime_type: string;
  started_at: Timestamp; completed_at: Timestamp; last_activity_at: Timestamp;
  total_duration_ms: number | null; completion_rate: string | number | null;
  created_at: Timestamp; updated_at: Timestamp;
}

const flowResource = (row: FlowRow): FlowResource => ({
  id: String(row.id),
  created_by_user_id: String(row.user_id),
  name: row.name,
  description: row.description,
  status: row.status,
  version: row.version,
  created_at: iso(row.created_at)!,
  updated_at: iso(row.updated_at)!
});

export class PostgresFlowRepository implements FlowRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listFlows(companyId: number, query: IncrementalQuery): Promise<ResourcePage<FlowResource>> {
    const [cursorDate, cursorId] = cursorParameters(query);
    const result = await this.pool.query<FlowRow>(
      `SELECT id, user_id, name, description, status, version, created_at, updated_at
         FROM flows
        WHERE company_id = $1
          AND ($2::timestamp IS NULL OR updated_at >= $2::timestamp)
          AND ($3::timestamp IS NULL OR (created_at, id) < ($3::timestamp, $4::integer))
        ORDER BY created_at DESC, id DESC
        LIMIT $5`,
      [companyId, query.updatedSince, cursorDate, cursorId, query.limit + 1]
    );
    return paged(result.rows.map(flowResource), query.limit);
  }

  async findFlow(companyId: number, flowId: number): Promise<FlowResource | null> {
    const result = await this.pool.query<FlowRow>(
      `SELECT id, user_id, name, description, status, version, created_at, updated_at
         FROM flows WHERE company_id = $1 AND id = $2`,
      [companyId, flowId]
    );
    return result.rows[0] === undefined ? null : flowResource(result.rows[0]);
  }

  async listAssignments(companyId: number, flowId: number, query: IncrementalQuery): Promise<ResourcePage<FlowAssignmentResource> | null> {
    const owner = await this.pool.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM flows WHERE id = $1 AND company_id = $2) AS exists",
      [flowId, companyId]
    );
    if (owner.rows[0]?.exists !== true) return null;
    const [cursorDate, cursorId] = cursorParameters(query);
    const result = await this.pool.query<AssignmentRow>(
      `SELECT flow_assignments.id, flow_assignments.flow_id, flow_assignments.channel_id,
              flow_assignments.is_active, flow_assignments.created_at, flow_assignments.updated_at
         FROM flow_assignments
         JOIN flows ON flows.id = flow_assignments.flow_id
         JOIN channel_connections ON channel_connections.id = flow_assignments.channel_id
        WHERE flow_assignments.flow_id = $1
          AND flows.company_id = $2
          AND channel_connections.company_id = $2
          AND ($3::timestamp IS NULL OR flow_assignments.updated_at >= $3::timestamp)
          AND ($4::timestamp IS NULL OR (flow_assignments.created_at, flow_assignments.id) < ($4::timestamp, $5::integer))
        ORDER BY flow_assignments.created_at DESC, flow_assignments.id DESC
        LIMIT $6`,
      [flowId, companyId, query.updatedSince, cursorDate, cursorId, query.limit + 1]
    );
    return paged(result.rows.map((row) => ({
      id: String(row.id), flow_id: String(row.flow_id), channel_id: String(row.channel_id),
      active: row.is_active, created_at: iso(row.created_at)!, updated_at: iso(row.updated_at)!
    })), query.limit);
  }

  async listExecutions(companyId: number, query: FlowExecutionQuery): Promise<ResourcePage<FlowExecutionResource>> {
    const [cursorDate, cursorId] = cursorParameters(query);
    const result = await this.pool.query<ExecutionRow>(
      `SELECT flow_executions.id, flow_executions.run_id, flow_executions.flow_id,
              flow_executions.conversation_id, flow_executions.contact_id, flow_executions.status,
              flow_executions.trigger_node_id, flow_executions.current_node_id,
              flow_executions.runtime_type, flow_executions.started_at,
              flow_executions.completed_at, flow_executions.last_activity_at,
              flow_executions.total_duration_ms, flow_executions.completion_rate,
              flow_executions.created_at, flow_executions.updated_at
         FROM flow_executions
         JOIN flows ON flows.id = flow_executions.flow_id
        WHERE flow_executions.company_id = $1
          AND flows.company_id = $1
          AND ($2::integer IS NULL OR flow_executions.flow_id = $2::integer)
          AND ($3::text IS NULL OR flow_executions.status = $3::text)
          AND ($4::timestamp IS NULL OR flow_executions.updated_at >= $4::timestamp)
          AND ($5::timestamp IS NULL OR (flow_executions.created_at, flow_executions.id) < ($5::timestamp, $6::integer))
        ORDER BY flow_executions.created_at DESC, flow_executions.id DESC
        LIMIT $7`,
      [companyId, query.flowId, query.status, query.updatedSince, cursorDate, cursorId, query.limit + 1]
    );
    return paged(result.rows.map((row) => ({
      id: String(row.id), run_id: row.run_id, flow_id: String(row.flow_id),
      conversation_id: String(row.conversation_id), contact_id: String(row.contact_id),
      status: row.status, trigger_node_id: row.trigger_node_id, current_node_id: row.current_node_id,
      runtime_type: row.runtime_type, started_at: iso(row.started_at)!, completed_at: iso(row.completed_at),
      last_activity_at: iso(row.last_activity_at)!, total_duration_ms: row.total_duration_ms,
      completion_rate: row.completion_rate === null ? null : String(row.completion_rate),
      created_at: iso(row.created_at)!, updated_at: iso(row.updated_at)!
    })), query.limit);
  }
}
