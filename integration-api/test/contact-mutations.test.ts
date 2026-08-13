import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";
import type {
  ContactMutationInput,
  ContactMutationRepository,
  ContactMutationResource,
  NoteMutationResource
} from "../src/resources/contact-mutations.js";
import type {
  IdempotencyRecord,
  IdempotencyRepository,
  IdempotencyScope
} from "../src/http/idempotency.js";

const rawKey = `pcp_${"c".repeat(64)}`;
const keyHash = createHash("sha256").update(rawKey.slice(4)).digest("hex");
const authHeaders = { authorization: `Bearer ${rawKey}` };
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

const keyRecord: ApiKeyRecord = {
  id: 9,
  companyId: 12,
  companyName: "Empresa de prueba",
  userId: 4,
  name: "Partner integration",
  keyHash,
  permissions: ["contacts:write", "notes:write", "tags:write"],
  isActive: true,
  expiresAt: null,
  allowedIps: []
};

class MemoryApiKeyRepository implements ApiKeyRepository {
  async findByHash(hash: string): Promise<ApiKeyRecord | null> {
    return hash === keyHash ? keyRecord : null;
  }

  async markUsed(): Promise<void> {}
}

class MemoryIdempotencyRepository implements IdempotencyRepository {
  records = new Map<string, IdempotencyRecord>();
  private locks = new Map<string, Promise<void>>();

  private key(scope: IdempotencyScope): string {
    return `${scope.apiKeyId}:${scope.method}:${scope.path}:${scope.key}`;
  }

  async find(scope: IdempotencyScope): Promise<IdempotencyRecord | null> {
    return this.records.get(this.key(scope)) ?? null;
  }

  async save(scope: IdempotencyScope, record: IdempotencyRecord): Promise<void> {
    this.records.set(this.key(scope), record);
  }

  async runExclusive<T>(scope: IdempotencyScope, operation: () => Promise<T>): Promise<T> {
    const key = this.key(scope);
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.locks.set(key, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(key) === queued) this.locks.delete(key);
    }
  }

}

class MemoryContactMutationRepository implements ContactMutationRepository {
  contacts = new Map<number, ContactMutationResource & { companyId: number }>();
  notes = new Map<number, NoteMutationResource & { companyId: number }>();
  private contactId = 100;
  private noteId = 800;

  constructor(private readonly createDelayMs = 0) {}

  async createContact(companyId: number, userId: number, input: ContactMutationInput) {
    if (this.createDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.createDelayMs));
    }
    const id = ++this.contactId;
    const now = "2026-08-13T12:00:00.000Z";
    const contact = {
      id: String(id),
      companyId,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      avatar_url: input.avatar_url ?? null,
      company: input.company ?? null,
      tags: input.tags ?? [],
      source: input.source ?? "api",
      notes: input.notes ?? null,
      custom_fields: input.custom_fields ?? {},
      archived: false,
      created_at: now,
      updated_at: now
    };
    this.contacts.set(id, contact);
    const { companyId: _companyId, ...resource } = contact;
    return resource;
  }

  async updateContact(companyId: number, contactId: number, input: Partial<ContactMutationInput>) {
    const current = this.contacts.get(contactId);
    if (current === undefined || current.companyId !== companyId) return null;
    const updated = {
      ...current,
      ...input,
      email: input.email === undefined ? current.email : input.email,
      phone: input.phone === undefined ? current.phone : input.phone,
      updated_at: "2026-08-13T12:01:00.000Z"
    };
    this.contacts.set(contactId, updated);
    const { companyId: _companyId, ...resource } = updated;
    return resource;
  }

  async archiveContact(companyId: number, contactId: number) {
    const current = this.contacts.get(contactId);
    if (current === undefined || current.companyId !== companyId) return null;
    const updated = { ...current, archived: true, updated_at: "2026-08-13T12:02:00.000Z" };
    this.contacts.set(contactId, updated);
    const { companyId: _companyId, ...resource } = updated;
    return resource;
  }

  async createNote(companyId: number, contactId: number, userId: number, content: string) {
    const contact = this.contacts.get(contactId);
    if (contact === undefined || contact.companyId !== companyId) return null;
    const id = ++this.noteId;
    const note = {
      id: String(id),
      companyId,
      contact_id: String(contactId),
      created_by_id: String(userId),
      content,
      created_at: "2026-08-13T12:03:00.000Z",
      updated_at: "2026-08-13T12:03:00.000Z"
    };
    this.notes.set(id, note);
    const { companyId: _companyId, ...resource } = note;
    return resource;
  }

  async updateNote(companyId: number, noteId: number, content: string) {
    const current = this.notes.get(noteId);
    if (current === undefined || current.companyId !== companyId) return null;
    const updated = { ...current, content, updated_at: "2026-08-13T12:04:00.000Z" };
    this.notes.set(noteId, updated);
    const { companyId: _companyId, ...resource } = updated;
    return resource;
  }

  async deleteNote(companyId: number, noteId: number): Promise<boolean> {
    const current = this.notes.get(noteId);
    return current !== undefined && current.companyId === companyId
      ? this.notes.delete(noteId)
      : false;
  }

  async attachTag(companyId: number, contactId: number, tag: string) {
    const current = this.contacts.get(contactId);
    if (current === undefined || current.companyId !== companyId) return null;
    const tags = current.tags.includes(tag) ? current.tags : [...current.tags, tag];
    const updated = { ...current, tags };
    this.contacts.set(contactId, updated);
    const { companyId: _companyId, ...resource } = updated;
    return resource;
  }

  async detachTag(companyId: number, contactId: number, tag: string) {
    const current = this.contacts.get(contactId);
    if (current === undefined || current.companyId !== companyId) return null;
    const updated = { ...current, tags: current.tags.filter((item) => item !== tag) };
    this.contacts.set(contactId, updated);
    const { companyId: _companyId, ...resource } = updated;
    return resource;
  }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp(options: { contactCreateDelayMs?: number } = {}) {
  const idempotency = new MemoryIdempotencyRepository();
  const contacts = new MemoryContactMutationRepository(options.contactCreateDelayMs);
  const app = await buildApp({
    apiKeyRepository: new MemoryApiKeyRepository(),
    contactMutationRepository: contacts,
    idempotencyRepository: idempotency,
    logger: false
  });
  apps.push(app);
  return { app, contacts, idempotency };
}

describe("contact mutations", () => {
  it("requires an idempotency key when creating a contact", async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/contacts",
      headers: authHeaders,
      payload: { name: "Ana" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("idempotency_key_required");
  });

  it("creates one contact and replays the same result after a retry", async () => {
    const { app, contacts } = await makeApp();
    const request = {
      method: "POST" as const,
      url: "/api/v1/contacts",
      headers: { ...authHeaders, "idempotency-key": "contact-smartbc-001" },
      payload: { name: "Ana", phone: "+34600000001", tags: ["cliente"] }
    };

    const first = await app.inject(request);
    const replay = await app.inject(request);

    expect(first.statusCode).toBe(201);
    expect(first.json().data.name).toBe("Ana");
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.json()).toEqual(first.json());
    expect(contacts.contacts.size).toBe(1);
  });

  it("rejects reuse of an idempotency key with a different payload", async () => {
    const { app } = await makeApp();
    const headers = { ...authHeaders, "idempotency-key": "contact-smartbc-002" };
    await app.inject({ method: "POST", url: "/api/v1/contacts", headers, payload: { name: "Ana" } });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/contacts",
      headers,
      payload: { name: "Bea" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("idempotency_conflict");
  });

  it("serializes simultaneous retries so the contact is created once", async () => {
    const { app, contacts } = await makeApp({ contactCreateDelayMs: 25 });
    const request = {
      method: "POST" as const,
      url: "/api/v1/contacts",
      headers: { ...authHeaders, "idempotency-key": "contact-smartbc-concurrent" },
      payload: { name: "Ana concurrente" }
    };

    const responses = await Promise.all([app.inject(request), app.inject(request)]);

    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    expect(responses.map((response) => response.json())).toEqual([
      responses[0]!.json(),
      responses[0]!.json()
    ]);
    expect(responses.filter((response) => response.headers["idempotent-replayed"] === "true")).toHaveLength(1);
    expect(contacts.contacts.size).toBe(1);
  });

  it("rejects unknown contact fields", async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/contacts",
      headers: { ...authHeaders, "idempotency-key": "contact-smartbc-003" },
      payload: { name: "Ana", company_id: 99 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
  });

  it("returns 404 when updating a contact outside the company", async () => {
    const { app, contacts } = await makeApp();
    await contacts.createContact(99, 1, { name: "Ajeno" });
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/contacts/101",
      headers: authHeaders,
      payload: { name: "Intento" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("contact_not_found");
  });
});

describe("notes and tags", () => {
  it("creates a note for a contact in the authenticated company", async () => {
    const { app, contacts } = await makeApp();
    const contact = await contacts.createContact(12, 4, { name: "Ana" });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/contacts/${contact.id}/notes`,
      headers: { ...authHeaders, "idempotency-key": "note-smartbc-001" },
      payload: { content: "Prefiere contacto por la tarde" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toEqual(expect.objectContaining({
      contact_id: contact.id,
      content: "Prefiere contacto por la tarde"
    }));
  });

  it("attaches a tag once and then detaches it", async () => {
    const { app, contacts } = await makeApp();
    const contact = await contacts.createContact(12, 4, { name: "Ana" });

    const attach = await app.inject({
      method: "PUT",
      url: `/api/v1/contacts/${contact.id}/tags/cliente-prioritario`,
      headers: authHeaders
    });
    await app.inject({
      method: "PUT",
      url: `/api/v1/contacts/${contact.id}/tags/cliente-prioritario`,
      headers: authHeaders
    });
    const detach = await app.inject({
      method: "DELETE",
      url: `/api/v1/contacts/${contact.id}/tags/cliente-prioritario`,
      headers: authHeaders
    });

    expect(attach.json().data.tags).toEqual(["cliente-prioritario"]);
    expect(detach.json().data.tags).toEqual([]);
  });
});
