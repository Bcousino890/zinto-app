import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";
import type { IdempotencyRecord, IdempotencyRepository, IdempotencyScope } from "../src/http/idempotency.js";
import type { TaskMutationInput, TaskMutationPatch, TaskMutationRepository } from "../src/resources/task-mutations.js";
import type { TaskResource } from "../src/resources/pipelines.js";

const rawKey = `pcp_${"a".repeat(64)}`;
const hash = createHash("sha256").update(rawKey.slice(4)).digest("hex");
const auth = { authorization: `Bearer ${rawKey}` };
const key: ApiKeyRecord = {
  id: 17, companyId: 12, companyName: "Empresa", userId: 7, name: "Partner",
  keyHash: hash, permissions: ["tasks:write"], isActive: true, expiresAt: null, allowedIps: []
};

class Keys implements ApiKeyRepository {
  async findByHash(value: string) { return value === hash ? key : null; }
  async markUsed() {}
}

class Idempotency implements IdempotencyRepository {
  records = new Map<string, IdempotencyRecord>();
  private locks = new Map<string, Promise<void>>();
  private id(scope: IdempotencyScope) { return `${scope.apiKeyId}:${scope.method}:${scope.path}:${scope.key}`; }
  async find(scope: IdempotencyScope) { return this.records.get(this.id(scope)) ?? null; }
  async save(scope: IdempotencyScope, value: IdempotencyRecord) { this.records.set(this.id(scope), value); }
  async runExclusive<T>(scope: IdempotencyScope, fn: () => Promise<T>) {
    const id = this.id(scope); const previous = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void; const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current); this.locks.set(id, queued); await previous;
    try { return await fn(); } finally { release(); if (this.locks.get(id) === queued) this.locks.delete(id); }
  }
}

const task = (id = "501"): TaskResource => ({
  id, contact_id: "101", title: "Llamar", description: null, priority: "medium", status: "pending",
  due_date: null, completed_at: null, assigned_to: null, category: null, tags: [], background_color: null,
  created_by_user_id: "7", updated_by_user_id: "7", created_at: "2026-08-13T10:00:00.000Z", updated_at: "2026-08-13T10:00:00.000Z"
});

class Tasks implements TaskMutationRepository {
  calls = 0;
  async createTask(companyId: number, userId: number, input: TaskMutationInput) { this.calls++; return input.contact_id === "101" && companyId === 12 ? task() : null; }
  async updateTask(companyId: number, id: number, userId: number, input: TaskMutationPatch) { this.calls++; return companyId === 12 && id === 501 ? { ...task(), ...input } : null; }
  async deleteTask(companyId: number, id: number, userId: number) { this.calls++; return companyId === 12 && id === 501; }
}

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function make(readOnly = false, allow = false) {
  const tasks = new Tasks(); const idempotency = new Idempotency();
  const app = await buildApp({
    apiKeyRepository: new Keys(), idempotencyRepository: idempotency, taskMutationRepository: tasks,
    logger: false, readOnly, writeEnabledApiKeyIds: new Set(allow ? [key.id] : [])
  });
  apps.push(app); return { app, tasks };
}

describe("task mutation routes", () => {
  it("requires tasks:write and idempotency for creation", async () => {
    const { app } = await make();
    const response = await app.inject({ method: "POST", url: "/api/v1/tasks", headers: auth, payload: { contact_id: "101", title: "Llamar" } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("idempotency_key_required");
  });

  it("allows an allowlisted key while global read-only remains enabled", async () => {
    const { app } = await make(true, true);
    const response = await app.inject({ method: "POST", url: "/api/v1/tasks", headers: { ...auth, "idempotency-key": "task-1" }, payload: { contact_id: "101", title: "Llamar" } });
    expect(response.statusCode).toBe(201);
  });

  it("replays an idempotent creation without calling the repository twice", async () => {
    const { app, tasks } = await make();
    const request = { method: "POST" as const, url: "/api/v1/tasks", headers: { ...auth, "idempotency-key": "task-2" }, payload: { contact_id: "101", title: "Llamar" } };
    expect((await app.inject(request)).statusCode).toBe(201);
    const replay = await app.inject(request);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(tasks.calls).toBe(1);
  });

  it("rejects an idempotency key reused with a different body", async () => {
    const { app, tasks } = await make();
    const headers = { ...auth, "idempotency-key": "task-conflict" };
    expect((await app.inject({ method: "POST", url: "/api/v1/tasks", headers, payload: { contact_id: "101", title: "Llamar" } })).statusCode).toBe(201);
    const response = await app.inject({ method: "POST", url: "/api/v1/tasks", headers, payload: { contact_id: "101", title: "Otro" } });
    expect(response.statusCode).toBe(409);
    expect(tasks.calls).toBe(1);
  });

  it("requires an idempotency key for update and delete", async () => {
    const { app } = await make();
    const update = await app.inject({ method: "PATCH", url: "/api/v1/tasks/501", headers: auth, payload: { status: "completed" } });
    const remove = await app.inject({ method: "DELETE", url: "/api/v1/tasks/501", headers: auth });
    expect(update.statusCode).toBe(400);
    expect(remove.statusCode).toBe(400);
  });

  it("returns the same not-found result for a task outside the company", async () => {
    const { app } = await make();
    const response = await app.inject({ method: "PATCH", url: "/api/v1/tasks/999", headers: { ...auth, "idempotency-key": "task-3" }, payload: { status: "completed" } });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("task_not_found");
  });

  it("rejects unsafe numeric ids instead of rounding them", async () => {
    const { app } = await make();
    const response = await app.inject({ method: "PATCH", url: "/api/v1/tasks/9007199254740992", headers: { ...auth, "idempotency-key": "task-large" }, payload: { status: "completed" } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
  });
});
