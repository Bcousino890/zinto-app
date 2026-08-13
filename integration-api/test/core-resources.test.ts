import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";
import { decodeCursor, encodeCursor } from "../src/http/pagination.js";
import type {
  ChannelResource,
  ContactResource,
  ConversationResource,
  CoreRepository,
  IncrementalQuery,
  MessageResource,
  ResourcePage
} from "../src/resources/core.js";

const rawKey = `pcp_${"b".repeat(64)}`;
const keyHash = createHash("sha256").update(rawKey.slice(4)).digest("hex");
const authorization = { authorization: `Bearer ${rawKey}` };
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

const keyRecord: ApiKeyRecord = {
  id: 8,
  companyId: 12,
  companyName: "Empresa de prueba",
  userId: 4,
  name: "Partner integration",
  keyHash,
  permissions: [
    "channels:read",
    "contacts:read",
    "conversations:read",
    "messages:read"
  ],
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

const contacts: Array<ContactResource & { companyId: number }> = [
  {
    id: "103",
    companyId: 12,
    name: "Contacto tres",
    email: null,
    phone: "+34600000103",
    avatar_url: null,
    company: null,
    tags: [],
    source: "whatsapp",
    notes: null,
    custom_fields: {},
    archived: false,
    created_at: "2026-08-13T10:00:00.000Z",
    updated_at: "2026-08-13T10:00:00.000Z"
  },
  {
    id: "102",
    companyId: 12,
    name: "Contacto dos",
    email: null,
    phone: "+34600000102",
    avatar_url: null,
    company: null,
    tags: ["cliente"],
    source: "whatsapp",
    notes: null,
    custom_fields: {},
    archived: false,
    created_at: "2026-08-12T10:00:00.000Z",
    updated_at: "2026-08-12T10:00:00.000Z"
  },
  {
    id: "101",
    companyId: 12,
    name: "Contacto uno",
    email: "uno@example.test",
    phone: "+34600000101",
    avatar_url: null,
    company: "Cliente",
    tags: [],
    source: "manual",
    notes: "Nota visible",
    custom_fields: { locale: "es" },
    archived: false,
    created_at: "2026-08-11T10:00:00.000Z",
    updated_at: "2026-08-11T10:00:00.000Z"
  },
  {
    id: "999",
    companyId: 99,
    name: "Contacto de otra empresa",
    email: null,
    phone: "+34600000999",
    avatar_url: null,
    company: null,
    tags: [],
    source: "manual",
    notes: null,
    custom_fields: {},
    archived: false,
    created_at: "2026-08-13T11:00:00.000Z",
    updated_at: "2026-08-13T11:00:00.000Z"
  }
];

const conversations: Array<ConversationResource & { companyId: number }> = [
  {
    id: "501",
    companyId: 12,
    contact_id: "101",
    channel_id: "22",
    channel_type: "whatsapp",
    status: "open",
    assigned_to_user_id: null,
    last_message_at: "2026-08-13T12:00:00.000Z",
    unread_count: 0,
    bot_disabled: false,
    archived: false,
    created_at: "2026-08-11T12:00:00.000Z",
    updated_at: "2026-08-13T12:00:00.000Z"
  }
];

const messages: Array<MessageResource & { companyId: number }> = [
  {
    id: "702",
    companyId: 12,
    conversation_id: "501",
    external_id: "wamid.new",
    direction: "incoming",
    type: "text",
    content: "Mensaje de hoy",
    status: "received",
    sender_id: null,
    sender_type: "contact",
    from_bot: false,
    media_url: null,
    sent_at: "2026-08-13T12:00:00.000Z",
    read_at: null,
    created_at: "2026-08-13T12:00:00.000Z"
  },
  {
    id: "701",
    companyId: 12,
    conversation_id: "501",
    external_id: "wamid.old",
    direction: "outgoing",
    type: "text",
    content: "Mensaje de hace dos días",
    status: "delivered",
    sender_id: "4",
    sender_type: "user",
    from_bot: false,
    media_url: null,
    sent_at: "2026-08-11T12:00:00.000Z",
    read_at: "2026-08-11T12:01:00.000Z",
    created_at: "2026-08-11T12:00:00.000Z"
  }
];

/**
 * `updated_since` es un filtro independiente del cursor: se aplica antes de
 * paginar y nunca cambia el orden por `created_at`, igual que en el
 * repositorio Postgres real.
 */
function page<T extends { id: string; created_at: string; updated_at?: string }>(
  items: T[],
  query: IncrementalQuery
): ResourcePage<T> {
  const eligible = query.updatedSince === null
    ? items
    : items.filter((item) => (item.updated_at ?? item.created_at) >= query.updatedSince!);
  const tenantItems = [...eligible].sort((a, b) =>
    b.created_at.localeCompare(a.created_at) || Number(b.id) - Number(a.id)
  );
  const cursor = query.cursor === null ? null : decodeCursor(query.cursor);
  const start = cursor === null
    ? 0
    : tenantItems.findIndex((item) => item.id === cursor.id && item.created_at === cursor.createdAt) + 1;
  const selected = tenantItems.slice(start, start + query.limit);
  const hasMore = start + query.limit < tenantItems.length;
  const last = selected.at(-1);
  return {
    items: selected,
    hasMore,
    nextCursor: hasMore && last !== undefined
      ? encodeCursor({ id: last.id, createdAt: last.created_at })
      : null
  };
}

class MemoryCoreRepository implements CoreRepository {
  async listChannels(companyId: number): Promise<ChannelResource[]> {
    return companyId === 12
      ? [{ id: "22", type: "whatsapp", name: "WhatsApp ESPAÑA", status: "active", capabilities: ["text", "media"] }]
      : [];
  }

  async listContacts(companyId: number, query: IncrementalQuery): Promise<ResourcePage<ContactResource>> {
    const result = page(contacts.filter((item) => item.companyId === companyId), query);
    return {
      ...result,
      items: result.items.map(({ companyId: _companyId, ...item }) => item)
    };
  }

  async listConversations(companyId: number, query: IncrementalQuery): Promise<ResourcePage<ConversationResource>> {
    return page(conversations.filter((item) => item.companyId === companyId), query);
  }

  async listMessages(
    companyId: number,
    conversationId: number,
    query: IncrementalQuery
  ): Promise<ResourcePage<MessageResource> | null> {
    const conversation = conversations.find(
      (item) => item.companyId === companyId && item.id === String(conversationId)
    );
    return conversation === undefined
      ? null
      : page(messages.filter((item) => item.companyId === companyId), query);
  }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp() {
  const app = await buildApp({
    apiKeyRepository: new MemoryApiKeyRepository(),
    coreRepository: new MemoryCoreRepository(),
    logger: false
  });
  apps.push(app);
  return app;
}

describe("core resource API", () => {
  it("returns only public channel fields and capabilities", async () => {
    const app = await makeApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/channels", headers: authorization });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([
      { id: "22", type: "whatsapp", name: "WhatsApp ESPAÑA", status: "active", capabilities: ["text", "media"] }
    ]);
    expect(response.body).not.toContain("access_token");
    expect(response.body).not.toContain("connection_data");
  });

  it("paginates contacts with an opaque cursor and never leaks another company", async () => {
    const app = await makeApp();
    const first = await app.inject({
      method: "GET",
      url: "/api/v1/contacts?limit=2",
      headers: authorization
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().data.map((item: { id: string }) => item.id)).toEqual(["103", "102"]);
    expect(first.json().meta.has_more).toBe(true);
    expect(first.json().meta.next_cursor).toEqual(expect.any(String));

    const second = await app.inject({
      method: "GET",
      url: `/api/v1/contacts?limit=2&cursor=${encodeURIComponent(first.json().meta.next_cursor)}`,
      headers: authorization
    });
    expect(second.json().data.map((item: { id: string }) => item.id)).toEqual(["101"]);
    expect(second.json().data).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "999" })
    ]));
    expect(second.json().data).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Contacto de otra empresa" })
    ]));
  });

  it("returns complete historical messages rather than only today's records", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/501/messages",
      headers: authorization
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.map((item: { content: string }) => item.content)).toEqual([
      "Mensaje de hoy",
      "Mensaje de hace dos días"
    ]);
  });

  it("hides a conversation outside the authenticated company", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/999/messages",
      headers: authorization
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("conversation_not_found");
  });

  it("filters contacts by updated_since without disturbing the created_at cursor order", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/contacts?updated_since=2026-08-12T00:00:00.000Z",
      headers: authorization
    });

    expect(response.statusCode).toBe(200);
    // Contacto uno (101) fue actualizado el 11 de agosto: queda fuera del filtro,
    // pero el orden de los que si califican sigue siendo por created_at DESC.
    expect(response.json().data.map((item: { id: string }) => item.id)).toEqual(["103", "102"]);
  });

  it("returns the same page when updated_since is absent, unchanged from before this feature", async () => {
    const app = await makeApp();
    const first = await app.inject({
      method: "GET",
      url: "/api/v1/contacts",
      headers: authorization
    });
    const second = await app.inject({
      method: "GET",
      url: "/api/v1/contacts",
      headers: authorization
    });

    expect(first.json().data).toEqual(second.json().data);
    expect(first.json().meta.has_more).toEqual(second.json().meta.has_more);
    expect(first.json().meta.next_cursor).toEqual(second.json().meta.next_cursor);
    expect(first.json().data.map((item: { id: string }) => item.id)).toEqual(["103", "102", "101"]);
  });

  it("accepts updated_since on conversations and on conversation messages without rejecting the request", async () => {
    const app = await makeApp();
    const conversationsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/conversations?updated_since=2026-08-01T00:00:00.000Z",
      headers: authorization
    });
    const messagesResponse = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/501/messages?updated_since=2026-08-01T00:00:00.000Z",
      headers: authorization
    });

    expect(conversationsResponse.statusCode).toBe(200);
    expect(messagesResponse.statusCode).toBe(200);
  });

  it.each([
    "/api/v1/contacts?limit=0",
    "/api/v1/contacts?limit=201",
    "/api/v1/contacts?cursor=not-a-cursor",
    "/api/v1/contacts?unknown=true",
    "/api/v1/contacts?updated_since=not-a-date",
    "/api/v1/conversations?updated_since=not-a-date",
    "/api/v1/conversations/501/messages?updated_since=not-a-date"
  ])("rejects invalid pagination input: %s", async (url) => {
    const app = await makeApp();
    const response = await app.inject({ method: "GET", url, headers: authorization });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
  });
});
