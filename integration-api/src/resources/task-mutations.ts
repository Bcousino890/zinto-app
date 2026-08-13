import type pg from "pg";

import type { TaskResource } from "./pipelines.js";

export interface TaskMutationInput {
  contact_id: string;
  title: string;
  description?: string | null;
  priority?: string;
  status?: string;
  due_date?: string | null;
  assigned_to?: string | null;
  category?: string | null;
  tags?: string[];
  background_color?: string | null;
}

export type TaskMutationPatch = Partial<Omit<TaskMutationInput, "contact_id">> & {
  completed_at?: string | null;
};

export interface TaskMutationRepository {
  createTask(companyId: number, userId: number, input: TaskMutationInput): Promise<TaskResource | null>;
  updateTask(companyId: number, taskId: number, userId: number, input: TaskMutationPatch): Promise<TaskResource | null>;
  deleteTask(companyId: number, taskId: number, userId: number): Promise<boolean>;
}

interface TaskRow {
  id: number;
  contact_id: number;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  due_date: Date | null;
  completed_at: Date | null;
  assigned_to: string | null;
  category: string | null;
  tags: string[] | null;
  background_color: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: Date;
  updated_at: Date;
}

const columns = `id, contact_id, title, description, priority, status, due_date,
  completed_at, assigned_to, category, tags, background_color, created_by,
  updated_by, created_at, updated_at`;

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function resource(row: TaskRow): TaskResource {
  return {
    id: String(row.id), contact_id: String(row.contact_id), title: row.title,
    description: row.description, priority: row.priority, status: row.status,
    due_date: iso(row.due_date), completed_at: iso(row.completed_at),
    assigned_to: row.assigned_to, category: row.category, tags: row.tags ?? [],
    background_color: row.background_color,
    created_by_user_id: row.created_by === null ? null : String(row.created_by),
    updated_by_user_id: row.updated_by === null ? null : String(row.updated_by),
    created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString()
  };
}

export class PostgresTaskMutationRepository implements TaskMutationRepository {
  constructor(private readonly pool: pg.Pool) {}

  private async transaction<T>(operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('zinto.integration_api_origin', 'api', true)");
      const value = await operation(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async record(client: pg.PoolClient, companyId: number, userId: number, event: string, id: number, value: unknown) {
    await client.query(
      `INSERT INTO integration_api_audit_records
         (company_id, actor_user_id, action, resource_type, resource_id, new_values)
       VALUES ($1, $2, $3, 'task', $4, $5::jsonb)`,
      [companyId, userId, event, id, JSON.stringify(value)]
    );
    await client.query(
      `INSERT INTO integration_api_outbox
         (company_id, event_type, resource_type, resource_id, payload)
       VALUES ($1, $2, 'task', $3, $4::jsonb)`,
      [companyId, event, id, JSON.stringify(value)]
    );
  }

  async createTask(companyId: number, userId: number, input: TaskMutationInput): Promise<TaskResource | null> {
    return this.transaction(async (client) => {
      const result = await client.query<TaskRow>(
        `INSERT INTO contact_tasks
           (company_id, contact_id, title, description, priority, status, due_date,
            assigned_to, category, tags, background_color, created_by, updated_by)
         SELECT $1, c.id, $3, $4, COALESCE($5, 'medium'), COALESCE($6, 'pending'),
                $7::timestamp, $8, $9, $10::text[], $11, $12, $12
           FROM contacts c
          WHERE c.id = $2 AND c.company_id = $1 AND c.is_archived = false
         RETURNING ${columns}`,
        [companyId, Number(input.contact_id), input.title, input.description ?? null,
          input.priority ?? null, input.status ?? null, input.due_date ?? null,
          input.assigned_to ?? null, input.category ?? null, input.tags ?? [],
          input.background_color ?? null, userId]
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      const value = resource(row);
      await this.record(client, companyId, userId, "task.created", row.id, value);
      return value;
    });
  }

  async updateTask(companyId: number, taskId: number, userId: number, input: TaskMutationPatch): Promise<TaskResource | null> {
    return this.transaction(async (client) => {
      const normalized = { ...input };
      if (normalized.status === "completed" && normalized.completed_at === undefined) {
        normalized.completed_at = new Date().toISOString();
      } else if (normalized.status !== undefined && normalized.status !== "completed" && normalized.completed_at === undefined) {
        normalized.completed_at = null;
      } else if (normalized.completed_at !== undefined && normalized.status === undefined) {
        normalized.status = normalized.completed_at === null ? "pending" : "completed";
      }
      const result = await client.query<TaskRow>(
        `UPDATE contact_tasks SET
           title = CASE WHEN $3::boolean THEN $4 ELSE title END,
           description = CASE WHEN $5::boolean THEN $6 ELSE description END,
           priority = CASE WHEN $7::boolean THEN $8 ELSE priority END,
           status = CASE WHEN $9::boolean THEN $10 ELSE status END,
           due_date = CASE WHEN $11::boolean THEN $12::timestamp ELSE due_date END,
           completed_at = CASE WHEN $13::boolean THEN $14::timestamp ELSE completed_at END,
           assigned_to = CASE WHEN $15::boolean THEN $16 ELSE assigned_to END,
           category = CASE WHEN $17::boolean THEN $18 ELSE category END,
           tags = CASE WHEN $19::boolean THEN $20::text[] ELSE tags END,
           background_color = CASE WHEN $21::boolean THEN $22 ELSE background_color END,
           updated_by = $23, updated_at = now()
         WHERE id = $1 AND company_id = $2
         RETURNING ${columns}`,
        [taskId, companyId,
          normalized.title !== undefined, normalized.title ?? null,
          normalized.description !== undefined, normalized.description ?? null,
          normalized.priority !== undefined, normalized.priority ?? null,
          normalized.status !== undefined, normalized.status ?? null,
          normalized.due_date !== undefined, normalized.due_date ?? null,
          normalized.completed_at !== undefined, normalized.completed_at ?? null,
          normalized.assigned_to !== undefined, normalized.assigned_to ?? null,
          normalized.category !== undefined, normalized.category ?? null,
          normalized.tags !== undefined, normalized.tags ?? null,
          normalized.background_color !== undefined, normalized.background_color ?? null,
          userId]
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      const value = resource(row);
      await this.record(client, companyId, userId, "task.updated", row.id, value);
      if (value.status === "completed") {
        await this.record(client, companyId, userId, "task.completed", row.id, value);
      }
      return value;
    });
  }

  async deleteTask(companyId: number, taskId: number, userId: number): Promise<boolean> {
    return this.transaction(async (client) => {
      const result = await client.query<TaskRow>(
        `DELETE FROM contact_tasks
          WHERE id = $1 AND company_id = $2
        RETURNING ${columns}`,
        [taskId, companyId]
      );
      const row = result.rows[0];
      if (row === undefined) return false;
      await this.record(client, companyId, userId, "task.deleted", row.id, resource(row));
      return true;
    });
  }
}
