import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";
import type { DeliveryClient, DeliveryRequest, DeliveryResult } from "../src/delivery/client.js";
import type {
  IdempotencyRecord,
  IdempotencyRepository,
  IdempotencyScope
} from "../src/http/idempotency.js";
import type {
  ContactMutationInput,
  ContactMutationRepository,
  ContactMutationResource,
  NoteMutationResource
} from "../src/resources/contact-mutations.js";
import type {
  ChannelResource,
  ContactResource,
  ConversationResource,
  CoreRepository,
  IncrementalQuery,
  MessageResource,
  ResourcePage
} from "../src/resources/core.js";
import type {
  CreateWebhookInput,
  WebhookEndpoint,
  WebhookRepository
} from "../src/webhooks/repository.js";

/**
 * Every fixture below belongs to company 77. The suite drives the API with a key
 * bound to company 12 and asserts that no route can read, mutate or even
 * confirm the existence of another company's records.
 */
const OWNER = 77;
const CALLER = 12;

const rawKey = `pcp_${"a".repeat(64)}`;
const keyHash = createHash("sha256").update(rawKey.slice(4)).digest("hex");
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

const apiKey: ApiKeyRecord = {
  id: 31,
  companyId: CALLER,
  companyName: "Empresa que llama",
  userId: 4,
  name: "Partner integration",
  keyHash,
  permissions: ["*"],
  isActive: true,
  expiresAt: null,
  allowedIps: []
};

class MemoryApiKeys implements ApiKeyRepository {
  async findByHash(hash: string) { return hash === keyHash ? apiKey : null; }
  async markUsed() {}
}

class MemoryIdempotency implements IdempotencyRepository {
  private records = new Map<string, IdempotencyRecord>();
  private key(scope: IdempotencyScope) {
    return `${scope.apiKeyId}:${scope.method}:${scope.path}:${scope.key}`;
  }
  async find(scope: IdempotencyScope) { return this.records.get(this.key(scope)) ?? null; }
  async save(scope: IdempotencyScope, record: IdempotencyRecord) {
    this.records.set(this.key(scope), record);
  }
  async runExclusive<T>(_scope: IdempotencyScope, operation: () => Promise<T>): Promise<T> {
    return operation();
  }
}

const foreignContact: ContactResource & { companyId: number } = {
  companyId: OWNER,
  id: "500",
  name: "Contacto de otra empresa",
  email: "privado@otra.example",
  phone: "+34600000000",
  avatar_url: null,
  company: null,
  tags: ["vip"],
  source: "crm",
  notes: null,
  custom_fields: {},
  archived: false,
  created_at: "2026-08-01T10:00:00.000Z",
  updated_at: "2026-08-01T10:00:00.000Z"
};

const foreignNote: NoteMutationResource & { companyId: number } = {
  companyId: OWNER,
  id: "900",
  contact_id: "500",
  created_by_id: "7",
  content: "Nota privada de otra empresa",
  created_at: "2026-08-01T10:00:00.000Z",
  updated_at: "2026-08-01T10:00:00.000Z"
};

class MemoryContactMutations implements ContactMutationRepository {
  contacts = new Map<number, ContactMutationResource & { companyId: number }>([[500, { ...foreignContact }]]);
  notes = new Map<number, NoteMutationResource & { companyId: number }>([[900, { ...foreignNote }]]);
  writes = 0;

  private ownedContact(companyId: number, contactId: number) {
    const current = this.contacts.get(contactId);
    return current === undefined || current.companyId !== companyId ? null : current;
  }

  async createContact(companyId: number, _userId: number, input: ContactMutationInput) {
    this.writes += 1;
    const id = 600;
    const now = "2026-08-13T12:00:00.000Z";
    const created = {
      ...foreignContact, ...input, companyId, id: String(id),
      tags: input.tags ?? [], custom_fields: input.custom_fields ?? {},
      created_at: now, updated_at: now
    };
    this.contacts.set(id, created);
    const { companyId: _owner, ...resource } = created;
    return resource;
  }

  async updateContact(companyId: number, contactId: number, input: Partial<ContactMutationInput>) {
    const current = this.ownedContact(companyId, contactId);
    if (current === null) return null;
    this.writes += 1;
    const updated = { ...current, ...input };
    this.contacts.set(contactId, updated);
    const { companyId: _owner, ...resource } = updated;
    return resource;
  }

  async archiveContact(companyId: number, contactId: number) {
    const current = this.ownedContact(companyId, contactId);
    if (current === null) return null;
    this.writes += 1;
    const updated = { ...current, archived: true };
    this.contacts.set(contactId, updated);
    const { companyId: _owner, ...resource } = updated;
    return resource;
  }

  async createNote(companyId: number, contactId: number, _userId: number, content: string) {
    if (this.ownedContact(companyId, contactId) === null) return null;
    this.writes += 1;
    return { ...foreignNote, companyId, id: "901", content };
  }

  async updateNote(companyId: number, noteId: number, content: string) {
    const current = this.notes.get(noteId);
    if (current === undefined || current.companyId !== companyId) return null;
    this.writes += 1;
    const updated = { ...current, content };
    this.notes.set(noteId, updated);
    return updated;
  }

  async deleteNote(companyId: number, noteId: number) {
    const current = this.notes.get(noteId);
    if (current === undefined || current.companyId !== companyId) return false;
    this.writes += 1;
    this.notes.delete(noteId);
    return true;
  }

  async attachTag(companyId: number, contactId: number, tag: string) {
    const current = this.ownedContact(companyId, contactId);
    if (current === null) return null;
    this.writes += 1;
    const updated = { ...current, tags: [...current.tags, tag] };
    this.contacts.set(contactId, updated);
    const { companyId: _owner, ...resource } = updated;
    return resource;
  }

  async detachTag(companyId: number, contactId: number, tag: string) {
    const current = this.ownedContact(companyId, contactId);
    if (current === null) return null;
    this.writes += 1;
    const updated = { ...current, tags: current.tags.filter((item) => item !== tag) };
    this.contacts.set(contactId, updated);
    const { companyId: _owner, ...resource } = updated;
    return resource;
  }
}

const foreignChannel: ChannelResource = {
  id: "44", type: "whatsapp", name: "WhatsApp de otra empresa",
  status: "connected", capabilities: ["text", "media"]
};

const foreignMessage: MessageResource & { companyId: number } = {
  companyId: OWNER,
  id: "800",
  conversation_id: "700",
  external_id: null,
  direction: "incoming",
  type: "text",
  content: "Mensaje privado de otra empresa",
  status: "received",
  sender_id: null,
  sender_type: "contact",
  from_bot: false,
  media_url: null,
  sent_at: "2026-08-01T10:00:00.000Z",
  read_at: null,
  created_at: "2026-08-01T10:00:00.000Z"
};

const empty = <T>(): ResourcePage<T> => ({ items: [], hasMore: false, nextCursor: null });

class MemoryCore implements CoreRepository {
  async listChannels(companyId: number) { return companyId === OWNER ? [foreignChannel] : []; }
  async listContacts(companyId: number): Promise<ResourcePage<ContactResource>> {
    const { companyId: _owner, ...resource } = foreignContact;
    return companyId === OWNER
      ? { items: [resource], hasMore: false, nextCursor: null }
      : empty<ContactResource>();
  }
  async listConversations(companyId: number): Promise<ResourcePage<ConversationResource>> {
    return companyId === OWNER ? empty<ConversationResource>() : empty<ConversationResource>();
  }
  async listMessages(companyId: number, conversationId: number, _query: IncrementalQuery) {
    // Conversation 700 exists, but only for company 77.
    if (conversationId !== 700 || companyId !== OWNER) return null;
    return empty<MessageResource>();
  }
  async findMessage(companyId: number, messageId: number): Promise<MessageResource | null> {
    // Message 800 exists, but only for company 77: a caller from another
    // company must get 404 without learning that message 800 exists at all.
    if (messageId !== 800 || companyId !== OWNER) return null;
    const { companyId: _owner, ...resource } = foreignMessage;
    return resource;
  }
}

class MemoryWebhooks implements WebhookRepository {
  endpoints = new Map<number, WebhookEndpoint & { companyId: number }>([[
    12, {
      companyId: OWNER, id: "12", url: "https://otra.example/hook",
      event_types: ["message.created"], active: true,
      created_at: "2026-08-01T10:00:00.000Z"
    }
  ]]);
  async create(companyId: number, _apiKeyId: number, input: CreateWebhookInput) {
    const endpoint = {
      companyId, id: "13", url: input.url, event_types: input.eventTypes,
      active: true, created_at: "2026-08-13T12:00:00.000Z"
    };
    const { companyId: _owner, ...resource } = endpoint;
    return resource;
  }
  async list(companyId: number) {
    return [...this.endpoints.values()]
      .filter((item) => item.companyId === companyId)
      .map(({ companyId: _owner, ...resource }) => resource);
  }
  async disable(companyId: number, endpointId: number) {
    const current = this.endpoints.get(endpointId);
    if (current === undefined || current.companyId !== companyId) return false;
    this.endpoints.delete(endpointId);
    return true;
  }
}

class RecordingDelivery implements DeliveryClient {
  calls: DeliveryRequest[] = [];
  async deliver(request: DeliveryRequest): Promise<DeliveryResult> {
    this.calls.push(request);
    return {
      id: "1", external_id: null, status: "sent",
      timestamp: "2026-08-13T12:00:00.000Z",
      channel_type: "whatsapp", conversation_id: "700"
    };
  }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp() {
  const contacts = new MemoryContactMutations();
  const webhooks = new MemoryWebhooks();
  const delivery = new RecordingDelivery();
  const app = await buildApp({
    apiKeyRepository: new MemoryApiKeys(),
    contactMutationRepository: contacts,
    coreRepository: new MemoryCore(),
    deliveryClient: delivery,
    hostResolver: async () => ["93.184.216.34"],
    idempotencyRepository: new MemoryIdempotency(),
    logger: false,
    readOnly: false,
    webhookRepository: webhooks
  });
  apps.push(app);
  return { app, contacts, webhooks, delivery };
}

interface Probe {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  url: string;
  payload?: Record<string, unknown>;
  expected: number;
  code: string;
}

const probes: Probe[] = [
  { method: "PATCH", url: "/api/v1/contacts/500", payload: { name: "Secuestrado" }, expected: 404, code: "contact_not_found" },
  { method: "DELETE", url: "/api/v1/contacts/500", expected: 404, code: "contact_not_found" },
  { method: "POST", url: "/api/v1/contacts/500/notes", payload: { content: "Intruso" }, expected: 404, code: "contact_not_found" },
  { method: "PATCH", url: "/api/v1/notes/900", payload: { content: "Intruso" }, expected: 404, code: "note_not_found" },
  { method: "DELETE", url: "/api/v1/notes/900", expected: 404, code: "note_not_found" },
  { method: "PUT", url: "/api/v1/contacts/500/tags/vip", expected: 404, code: "contact_not_found" },
  { method: "DELETE", url: "/api/v1/contacts/500/tags/vip", expected: 404, code: "contact_not_found" },
  { method: "GET", url: "/api/v1/conversations/700/messages", expected: 404, code: "conversation_not_found" },
  { method: "GET", url: "/api/v1/messages/800", expected: 404, code: "message_not_found" },
  { method: "DELETE", url: "/api/v1/webhooks/12", expected: 404, code: "webhook_not_found" }
];

describe("multi-tenant isolation", () => {
  it.each(probes)("refuses $method $url with another company's ID", async (probe) => {
    const { app, contacts, webhooks } = await makeApp();
    const response = await app.inject({
      method: probe.method,
      url: probe.url,
      headers: {
        authorization: `Bearer ${rawKey}`,
        "idempotency-key": `isolation-${probe.method}-${probe.url}`
      },
      ...(probe.payload === undefined ? {} : { payload: probe.payload })
    });

    expect(response.statusCode).toBe(probe.expected);
    expect(response.json().error.code).toBe(probe.code);
    expect(contacts.writes).toBe(0);
    expect(contacts.notes.get(900)?.content).toBe("Nota privada de otra empresa");
    expect(contacts.contacts.get(500)).toEqual(foreignContact);
    expect(webhooks.endpoints.has(12)).toBe(true);
  });

  it("never lists another company's contacts, channels or webhooks", async () => {
    const { app } = await makeApp();
    const headers = { authorization: `Bearer ${rawKey}` };

    const [contacts, channels, webhooks] = await Promise.all([
      app.inject({ method: "GET", url: "/api/v1/contacts", headers }),
      app.inject({ method: "GET", url: "/api/v1/channels", headers }),
      app.inject({ method: "GET", url: "/api/v1/webhooks", headers })
    ]);

    expect(contacts.json().data).toEqual([]);
    expect(channels.json().data).toEqual([]);
    expect(webhooks.json().data).toEqual([]);
    for (const response of [contacts, channels, webhooks]) {
      expect(response.body).not.toContain("otra empresa");
      expect(response.body).not.toContain("privado@otra.example");
    }
  });

  it("refuses to send through another company's channel", async () => {
    const { app, delivery } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": "isolation-send" },
      payload: { channel_id: "44", to: "+34600000000", message: "Hola" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("channel_not_found");
    expect(delivery.calls).toEqual([]);
  });

  it("binds a created contact to the calling company, never to a client-supplied one", async () => {
    const { app, contacts } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/contacts",
      headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": "isolation-create" },
      payload: { name: "Contacto nuevo" }
    });

    expect(response.statusCode).toBe(201);
    expect(contacts.contacts.get(600)?.companyId).toBe(CALLER);
  });
});
