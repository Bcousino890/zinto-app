import type pg from "pg";
import { describe, expect, it } from "vitest";

import {
  PostgresTaskMutationRepository,
  type TaskMutationInput
} from "../src/resources/task-mutations.js";

interface Call { text: string; params: unknown[]; }
interface Rows { rows: unknown[]; }

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
      release: (): void => { this.releases += 1; }
    };
    return client as unknown as pg.PoolClient;
  }
}

const input: TaskMutationInput = {
  contact_id: "101",
  title: "Llamar al cliente",
  description: "Confirmar documentación",
  priority: "high",
  status: "pending",
  due_date: "2026-08-20T10:00:00.000Z",
  assigned_to: "Equipo comercial",
  category: "seguimiento",
  tags: ["urgente"],
  background_color: "#f59e0b"
};

const taskRow = {
  id: 501,
  contact_id: 101,
  title: input.title,
  description: input.description,
  priority: input.priority,
  status: input.status,
  due_date: new Date(input.due_date!),
  completed_at: null,
  assigned_to: input.assigned_to,
  category: input.category,
  tags: input.tags,
  background_color: input.background_color,
  created_by: 7,
  updated_by: 7,
  created_at: new Date("2026-08-13T10:00:00.000Z"),
  updated_at: new Date("2026-08-13T10:00:00.000Z")
};

function repository(overrides: Partial<typeof taskRow> = {}) {
  const row = { ...taskRow, ...overrides };
  const pool = new FakePool((text) => {
    if (text.includes("INSERT INTO contact_tasks") || text.includes("UPDATE contact_tasks")) {
      return { rows: [row] };
    }
    if (text.includes("SELECT id, contact_id") || text.includes("DELETE FROM contact_tasks")) {
      return { rows: [row] };
    }
    return { rows: [] };
  });
  return { pool, tasks: new PostgresTaskMutationRepository(pool as unknown as pg.Pool) };
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const find = (pool: FakePool, fragment: string) => pool.calls.find((call) => call.text.includes(fragment));
const eventCall = (pool: FakePool, event: string) => pool.calls.find((call) => call.params.includes(event));

describe("task mutation repository", () => {
  it("creates a task for the caller company and records audit plus outbox in one transaction", async () => {
    const { pool, tasks } = repository();
    const result = await tasks.createTask(12, 7, input);

    expect(result).toEqual(expect.objectContaining({ id: "501", contact_id: "101" }));
    const insert = find(pool, "INSERT INTO contact_tasks")!;
    expect(flat(insert.text)).toContain("company_id");
    expect(insert.params[0]).toBe(12);
    expect(insert.params).toContain(7);
    const audit = find(pool, "integration_api_audit_records")!;
    expect(audit.params.slice(0, 4)).toEqual([12, 7, "task.created", 501]);
    const outbox = find(pool, "integration_api_outbox")!;
    expect(outbox.params.slice(0, 3)).toEqual([12, "task.created", 501]);
    expect(pool.calls[0]!.text).toBe("BEGIN");
    expect(pool.calls.at(-1)!.text).toBe("COMMIT");
  });

  it("updates only a task owned by the caller company", async () => {
    const { pool, tasks } = repository();
    const result = await tasks.updateTask(12, 501, 7, { status: "completed", completed_at: "2026-08-13T11:00:00.000Z" });

    expect(result).toEqual(expect.objectContaining({ id: "501" }));
    const update = find(pool, "UPDATE contact_tasks")!;
    expect(flat(update.text)).toContain("WHERE id = $1 AND company_id = $2");
    expect(update.params[0]).toBe(501);
    expect(update.params[1]).toBe(12);
    expect(eventCall(pool, "task.updated")!.params.slice(0, 4)).toEqual([12, 7, "task.updated", 501]);
  });

  it("deletes only a task owned by the caller company and emits task.deleted", async () => {
    const { pool, tasks } = repository();
    const deleted = await tasks.deleteTask(12, 501, 7);

    expect(deleted).toBe(true);
    const remove = find(pool, "DELETE FROM contact_tasks")!;
    expect(flat(remove.text)).toContain("WHERE id = $1 AND company_id = $2");
    expect(remove.params).toEqual([501, 12]);
    expect(eventCall(pool, "task.deleted")!.params.slice(0, 4)).toEqual([12, 7, "task.deleted", 501]);
  });

  it("rolls back when the write fails", async () => {
    const pool = new FakePool((text) => {
      if (text.includes("INSERT INTO contact_tasks")) throw new Error("schema failure");
      return { rows: [] };
    });
    const tasks = new PostgresTaskMutationRepository(pool as unknown as pg.Pool);

    await expect(tasks.createTask(12, 7, input)).rejects.toThrow("schema failure");
    expect(pool.calls.at(-1)!.text).toBe("ROLLBACK");
    expect(pool.releases).toBe(1);
  });
});
