import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";
import type {
  ConversationCreateResult,
  ConversationMutationRepository
} from "../src/resources/conversation-mutations.js";
import type { IdempotencyRecord, IdempotencyRepository, IdempotencyScope } from "../src/http/idempotency.js";

const rawKey = `pcp_${"d".repeat(64)}`;
const keyHash = createHash("sha256").update(rawKey.slice(4)).digest("hex");
const authHeaders = { authorization: `Bearer ${rawKey}` };
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

function keyRecord(permissions: string[]): ApiKeyRecord {
  return {
    id: 9,
    companyId: 12,
    companyName: "Empresa de prueba",
    userId: 4,
    name: "Partner integration",
    keyHash,
    permissions,
    isActive: true,
    expiresAt: null,
    allowedIps: []
  };
}

class MemoryApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly permissions: string[]) {}

  async findByHash(hash: string): Promise<ApiKeyRecord | null> {
    return hash === keyHash ? keyRecord(this.permissions) : null;
  }

  async markUsed(): Promise<void> {}
}

interface StoredConversation {
  id: number;
  companyId: number;
  contactId: number;
  channelId: number;
  channelType: string;
}

/**
 * Doble en memoria del repositorio: la empresa 12 tiene el contacto 101 y el
 * canal 55; el contacto 900 y el canal 999 son de otra empresa y desde aqui
 * tienen que ser indistinguibles de los inexistentes.
 */
class MemoryConversationMutationRepository implements ConversationMutationRepository {
  conversations: StoredConversation[] = [];
  private nextId = 7000;
  private readonly contacts = new Map<number, number>([[101, 12], [102, 12], [900, 77]]);
  private readonly channels = new Map<number, { companyId: number; type: string }>([
    [55, { companyId: 12, type: "whatsapp_official" }],
    [56, { companyId: 12, type: "email" }],
    [999, { companyId: 77, type: "whatsapp_official" }]
  ]);

  async updateConversation(companyId: number, conversationId: number, _userId: number, input: import("../src/resources/conversation-mutations.js").ConversationUpdateInput) {
    const row = this.conversations.find((conversation) => conversation.companyId === companyId && conversation.id === conversationId);
    if (row === undefined) return null;
    return {
      id: String(row.id), contact_id: String(row.contactId), channel_id: String(row.channelId), channel_type: row.channelType,
      status: input.status ?? "open", assigned_to_user_id: input.assigned_to_user_id ?? null,
      last_message_at: "2026-08-13T12:00:00.000Z", unread_count: 0, bot_disabled: input.bot_disabled ?? false,
      archived: input.archived ?? false, created_at: "2026-08-13T12:00:00.000Z", updated_at: "2026-08-13T12:00:00.000Z"
    };
  }

  async findOrCreateConversation(
    companyId: number,
    contactId: number,
    channelId: number,
    _userId: number
  ): Promise<ConversationCreateResult> {
    if (this.contacts.get(contactId) !== companyId) {
      return { ok: false, reason: "contact_not_found" };
    }
    const channel = this.channels.get(channelId);
    if (channel === undefined || channel.companyId !== companyId) {
      return { ok: false, reason: "channel_not_found" };
    }
    const found = this.conversations.find((row) =>
      row.companyId === companyId && row.contactId === contactId && row.channelId === channelId);
    const row = found ?? {
      id: ++this.nextId,
      companyId,
      contactId,
      channelId,
      channelType: channel.type
    };
    if (found === undefined) this.conversations.push(row);
    return {
      ok: true,
      created: found === undefined,
      conversation: {
        id: String(row.id),
        contact_id: String(row.contactId),
        channel_id: String(row.channelId),
        channel_type: row.channelType,
        status: "open",
        assigned_to_user_id: null,
        last_message_at: "2026-08-13T12:00:00.000Z",
        unread_count: 0,
        bot_disabled: false,
        archived: false,
        created_at: "2026-08-13T12:00:00.000Z",
        updated_at: "2026-08-13T12:00:00.000Z"
      }
    };
  }
}

class MemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly records = new Map<string, IdempotencyRecord>();
  private key(scope: IdempotencyScope): string { return `${scope.apiKeyId}:${scope.method}:${scope.path}:${scope.key}`; }
  async find(scope: IdempotencyScope): Promise<IdempotencyRecord | null> { return this.records.get(this.key(scope)) ?? null; }
  async save(scope: IdempotencyScope, record: IdempotencyRecord): Promise<void> { this.records.set(this.key(scope), record); }
  async runExclusive<T>(_scope: IdempotencyScope, operation: () => Promise<T>): Promise<T> { return operation(); }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp(permissions: string[] = ["conversations:write"]) {
  const conversations = new MemoryConversationMutationRepository();
  const app = await buildApp({
    apiKeyRepository: new MemoryApiKeyRepository(permissions),
    conversationMutationRepository: conversations,
    idempotencyRepository: new MemoryIdempotencyRepository(),
    logger: false,
    readOnly: false
  });
  apps.push(app);
  return { app, conversations };
}

const create = (payload: unknown) => ({
  method: "POST" as const,
  url: "/api/v1/conversations",
  headers: authHeaders,
  payload: payload as Record<string, unknown>
});

describe("conversation find-or-create route", () => {
  it("creates the conversation and answers 201", async () => {
    const { app, conversations } = await makeApp();

    const response = await app.inject(create({ contact_id: "101", channel_id: "55" }));

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toEqual(expect.objectContaining({
      contact_id: "101",
      channel_id: "55",
      channel_type: "whatsapp_official"
    }));
    expect(response.json().meta.request_id).toMatch(/^req_/);
    expect(conversations.conversations).toHaveLength(1);
  });

  it("returns the same conversation with 200 when the pair already exists", async () => {
    const { app, conversations } = await makeApp();
    const request = create({ contact_id: "101", channel_id: "55" });

    const first = await app.inject(request);
    const second = await app.inject(request);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().data).toEqual(first.json().data);
    expect(conversations.conversations).toHaveLength(1);
  });

  it("keeps one conversation per contact and channel, not per contact", async () => {
    const { app, conversations } = await makeApp();

    await app.inject(create({ contact_id: "101", channel_id: "55" }));
    const other = await app.inject(create({ contact_id: "101", channel_id: "56" }));

    expect(other.statusCode).toBe(201);
    expect(other.json().data.channel_type).toBe("email");
    expect(conversations.conversations).toHaveLength(2);
  });

  it("hides a contact of another company behind the same 404", async () => {
    const { app, conversations } = await makeApp();

    const response = await app.inject(create({ contact_id: "900", channel_id: "55" }));

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("contact_not_found");
    expect(response.json().error.message).toBe("The contact was not found");
    expect(conversations.conversations).toHaveLength(0);
  });

  it("answers a contact of another company exactly like an absent one", async () => {
    const { app } = await makeApp();

    const foreign = await app.inject(create({ contact_id: "900", channel_id: "55" }));
    const absent = await app.inject(create({ contact_id: "424242", channel_id: "55" }));

    expect(foreign.statusCode).toBe(absent.statusCode);
    expect(foreign.json().error.code).toBe(absent.json().error.code);
    expect(foreign.json().error.message).toBe(absent.json().error.message);
  });

  it("hides a channel of another company behind the same 404", async () => {
    const { app, conversations } = await makeApp();

    const foreign = await app.inject(create({ contact_id: "101", channel_id: "999" }));
    const absent = await app.inject(create({ contact_id: "101", channel_id: "424242" }));

    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe("channel_not_found");
    expect(foreign.json().error.message).toBe(absent.json().error.message);
    expect(conversations.conversations).toHaveLength(0);
  });

  it("rejects identifiers that are not numeric strings", async () => {
    const { app, conversations } = await makeApp();

    for (const payload of [
      { contact_id: "abc", channel_id: "55" },
      { contact_id: "101", channel_id: "-1" },
      { contact_id: 101, channel_id: "55" },
      { contact_id: "101" }
    ]) {
      const response = await app.inject(create(payload));
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("validation_error");
    }
    expect(conversations.conversations).toHaveLength(0);
  });

  it("rejects an unknown field instead of letting it through", async () => {
    const { app, conversations } = await makeApp();

    const response = await app.inject(create({
      contact_id: "101",
      channel_id: "55",
      company_id: "77"
    }));

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
    expect(conversations.conversations).toHaveLength(0);
  });

  it("refuses a caller-supplied channel_type rather than trusting it", async () => {
    const { app, conversations } = await makeApp();

    // `channel_type` se deriva del canal real; aceptarlo del partner es lo
    // unico capaz de desincronizarlo de `channel_connections`.
    const response = await app.inject(create({
      contact_id: "101",
      channel_id: "55",
      channel_type: "email"
    }));

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
    expect(conversations.conversations).toHaveLength(0);
  });

  it("requires the conversations:write scope", async () => {
    const { app, conversations } = await makeApp(["conversations:read", "contacts:write"]);

    const response = await app.inject(create({ contact_id: "101", channel_id: "55" }));

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("insufficient_scope");
    expect(conversations.conversations).toHaveLength(0);
  });

  it("rejects the write while the service is in read-only mode", async () => {
    const conversations = new MemoryConversationMutationRepository();
    const app = await buildApp({
      apiKeyRepository: new MemoryApiKeyRepository(["conversations:write"]),
      conversationMutationRepository: conversations,
      logger: false,
      readOnly: true
    });
    apps.push(app);

    const response = await app.inject(create({ contact_id: "101", channel_id: "55" }));

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("read_only_mode");
    expect(conversations.conversations).toHaveLength(0);
  });

  it("updates a conversation with idempotency and tenant-safe not-found behavior", async () => {
    const { app } = await makeApp();
    const created = await app.inject(create({ contact_id: "101", channel_id: "55" }));
    const id = created.json().data.id;
    const response = await app.inject({
      method: "PATCH", url: `/api/v1/conversations/${id}`,
      headers: { ...authHeaders, "idempotency-key": "conversation-update-1" },
      payload: { archived: true, bot_disabled: true }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(expect.objectContaining({ archived: true, bot_disabled: true }));
    const missing = await app.inject({
      method: "PATCH", url: "/api/v1/conversations/999999",
      headers: { ...authHeaders, "idempotency-key": "conversation-update-2" }, payload: { archived: true }
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("conversation_not_found");
  });
});
