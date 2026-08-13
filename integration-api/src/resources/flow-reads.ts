import type pg from "pg";

import { cursorParameters, iso, paged, type PageQuery, type ResourcePage, type Timestamp } from "./core.js";

export interface FlowResource {
  id: string;
  name: string;
  description: string | null;
  status: string;
  nodes: unknown[];
  edges: unknown[];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface FlowSessionResource {
  id: string;
  session_id: string;
  flow_id: string;
  conversation_id: string;
  contact_id: string;
  status: string;
  current_node_id: string | null;
  trigger_node_id: string;
  execution_path: unknown[];
  session_data: Record<string, unknown>;
  started_at: string;
  last_activity_at: string;
  completed_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FlowExecutionResource {
  id: string;
  execution_id: string;
  flow_id: string;
  conversation_id: string;
  contact_id: string;
  status: string;
  trigger_node_id: string;
  current_node_id: string | null;
  execution_path: unknown[];
  started_at: string;
  completed_at: string | null;
  last_activity_at: string;
  total_duration_ms: number | null;
  completion_rate: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface FlowTemplateResource {
  id: string;
  name: string;
  description: string | null;
  category: string;
  business_type: string;
  nodes: unknown[];
  edges: unknown[];
  tags: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FlowReadRepository {
  listFlows(companyId: number, query: PageQuery): Promise<ResourcePage<FlowResource>>;
  findFlow(companyId: number, flowId: number): Promise<FlowResource | null>;
  listSessions(companyId: number, flowId: number, query: PageQuery): Promise<ResourcePage<FlowSessionResource> | null>;
  listExecutions(companyId: number, flowId: number, query: PageQuery): Promise<ResourcePage<FlowExecutionResource> | null>;
  listTemplates(query: PageQuery): Promise<ResourcePage<FlowTemplateResource>>;
}

interface FlowRow { id: number; name: string; description: string | null; status: string; nodes: unknown[]; edges: unknown[]; version: number; created_at: Timestamp; updated_at: Timestamp; }
interface SessionRow { id: number; session_id: string; flow_id: number; conversation_id: number; contact_id: number; status: string; current_node_id: string | null; trigger_node_id: string; execution_path: unknown[]; session_data: Record<string, unknown>; started_at: Timestamp; last_activity_at: Timestamp; completed_at: Timestamp | null; expires_at: Timestamp | null; created_at: Timestamp; updated_at: Timestamp; }
interface ExecutionRow { id: number; execution_id: string; flow_id: number; conversation_id: number; contact_id: number; status: string; trigger_node_id: string; current_node_id: string | null; execution_path: unknown[]; started_at: Timestamp; completed_at: Timestamp | null; last_activity_at: Timestamp; total_duration_ms: number | null; completion_rate: number | null; error_message: string | null; created_at: Timestamp; updated_at: Timestamp; }
interface TemplateRow { id: number; name: string; description: string | null; category: string; business_type: string; nodes: unknown[]; edges: unknown[]; tags: string[] | null; is_active: boolean; created_at: Timestamp; updated_at: Timestamp; }

const jsonArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const ref = (value: number): string => String(value);

function flowResource(row: FlowRow): FlowResource { return { id: ref(row.id), name: row.name, description: row.description, status: row.status, nodes: jsonArray(row.nodes), edges: jsonArray(row.edges), version: row.version, created_at: iso(row.created_at)!, updated_at: iso(row.updated_at)! }; }
function sessionResource(row: SessionRow): FlowSessionResource { return { id: ref(row.id), session_id: row.session_id, flow_id: ref(row.flow_id), conversation_id: ref(row.conversation_id), contact_id: ref(row.contact_id), status: row.status, current_node_id: row.current_node_id, trigger_node_id: row.trigger_node_id, execution_path: jsonArray(row.execution_path), session_data: row.session_data ?? {}, started_at: iso(row.started_at)!, last_activity_at: iso(row.last_activity_at)!, completed_at: iso(row.completed_at), expires_at: iso(row.expires_at), created_at: iso(row.created_at)!, updated_at: iso(row.updated_at)! }; }
function executionResource(row: ExecutionRow): FlowExecutionResource { return { id: ref(row.id), execution_id: row.execution_id, flow_id: ref(row.flow_id), conversation_id: ref(row.conversation_id), contact_id: ref(row.contact_id), status: row.status, trigger_node_id: row.trigger_node_id, current_node_id: row.current_node_id, execution_path: jsonArray(row.execution_path), started_at: iso(row.started_at)!, completed_at: iso(row.completed_at), last_activity_at: iso(row.last_activity_at)!, total_duration_ms: row.total_duration_ms, completion_rate: row.completion_rate, error_message: row.error_message, created_at: iso(row.created_at)!, updated_at: iso(row.updated_at)! }; }
function templateResource(row: TemplateRow): FlowTemplateResource { return { id: ref(row.id), name: row.name, description: row.description, category: row.category, business_type: row.business_type, nodes: jsonArray(row.nodes), edges: jsonArray(row.edges), tags: row.tags ?? [], is_active: row.is_active, created_at: iso(row.created_at)!, updated_at: iso(row.updated_at)! }; }

export class PostgresFlowReadRepository implements FlowReadRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listFlows(companyId: number, query: PageQuery): Promise<ResourcePage<FlowResource>> {
    return this.page("flows", "company_id = $1", [companyId], query, flowResource);
  }
  async findFlow(companyId: number, flowId: number): Promise<FlowResource | null> {
    const result = await this.pool.query<FlowRow>("SELECT id, name, description, status, nodes, edges, version, created_at, updated_at FROM flows WHERE company_id = $1 AND id = $2", [companyId, flowId]);
    return result.rows[0] === undefined ? null : flowResource(result.rows[0]);
  }
  async listSessions(companyId: number, flowId: number, query: PageQuery): Promise<ResourcePage<FlowSessionResource> | null> {
    if (!(await this.ownedFlow(companyId, flowId))) return null;
    return this.page("flow_sessions", "company_id = $1 AND flow_id = $2", [companyId, flowId], query, sessionResource);
  }
  async listExecutions(companyId: number, flowId: number, query: PageQuery): Promise<ResourcePage<FlowExecutionResource> | null> {
    if (!(await this.ownedFlow(companyId, flowId))) return null;
    return this.page("flow_executions", "company_id = $1 AND flow_id = $2", [companyId, flowId], query, executionResource);
  }
  async listTemplates(query: PageQuery): Promise<ResourcePage<FlowTemplateResource>> {
    return this.page("flow_templates", "is_active = TRUE", [], query, templateResource);
  }
  private async ownedFlow(companyId: number, flowId: number): Promise<boolean> {
    const result = await this.pool.query("SELECT 1 FROM flows WHERE id = $1 AND company_id = $2", [flowId, companyId]);
    return result.rowCount === 1;
  }
  private async page<T extends { id: number; created_at: Timestamp }, R extends { id: string; created_at: string }>(table: string, where: string, params: unknown[], query: PageQuery, map: (row: T) => R): Promise<ResourcePage<R>> {
    const [cursorDate, cursorId] = cursorParameters(query);
    const result = await this.pool.query<T & { id: number; created_at: Timestamp }>(`SELECT * FROM ${table} WHERE ${where} AND ($${params.length + 1}::timestamp IS NULL OR (created_at, id) < ($${params.length + 1}::timestamp, $${params.length + 2}::integer)) ORDER BY created_at DESC, id DESC LIMIT $${params.length + 3}`, [...params, cursorDate, cursorId, query.limit + 1]);
    return paged(result.rows.map(map), query.limit);
  }
}
