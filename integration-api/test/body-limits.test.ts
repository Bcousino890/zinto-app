import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";
import type { DeliveryClient, DeliveryRequest, DeliveryResult } from "../src/delivery/client.js";
import { globalBodyLimitBytes, messageBodyLimitBytes, webhookBodyLimitBytes } from "../src/http/body-limits.js";
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
import type { ChannelResource, CoreRepository, PageQuery, ResourcePage } from "../src/resources/core.js";
import type { CreateWebhookInput, WebhookEndpoint, WebhookRepository } from "../src/webhooks/repository.js";

const rawKey = `pcp_${"1".repeat(64)}`;
const keyHash = createHash("sha256").update(rawKey.slice(4)).digest("hex");
const headers = { authorization: `Bearer ${rawKey}` };
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

const apiKey: ApiKeyRecord = {
  id: 1,
  companyId: 1,
  companyName: "Empresa de prueba",
  userId: 1,
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
  private key(scope: IdempotencyScope) { return `${scope.apiKeyId}:${scope.method}:${scope.path}:${scope.key}`; }
  async find(scope: IdempotencyScope) { return this.records.get(this.key(scope)) ?? null; }
  async save(scope: IdempotencyScope, record: IdempotencyRecord) { this.records.set(this.key(scope), record); }
  async runExclusive<T>(_scope: IdempotencyScope, operation: () => Promise<T>): Promise<T> { return operation(); }
}

class MemoryContacts implements ContactMutationRepository {
  async createContact(_companyId: number, _userId: number, input: ContactMutationInput): Promise<ContactMutationResource> {
    const now = "2026-08-13T12:00:00.000Z";
    return {
      id: "1", name: input.name, email: input.email ?? null, phone: input.phone ?? null,
      avatar_url: input.avatar_url ?? null, company: input.company ?? null, tags: input.tags ?? [],
      source: input.source ?? "api", notes: input.notes ?? null, custom_fields: input.custom_fields ?? {},
      archived: false, created_at: now, updated_at: now
    };
  }
  async updateContact(): Promise<ContactMutationResource | null> { return null; }
  async archiveContact(): Promise<ContactMutationResource | null> { return null; }
  async createNote(): Promise<NoteMutationResource | null> { return null; }
  async updateNote(): Promise<NoteMutationResource | null> { return null; }
  async deleteNote(): Promise<boolean> { return false; }
  async attachTag(): Promise<ContactMutationResource | null> { return null; }
  async detachTag(): Promise<ContactMutationResource | null> { return null; }
}

class MemoryCore implements CoreRepository {
  async listChannels(): Promise<ChannelResource[]> {
    return [{ id: "1", type: "whatsapp", name: "WhatsApp", status: "active", capabilities: ["text"] }];
  }
  async listContacts(): Promise<ResourcePage<never>> { return { items: [], hasMore: false, nextCursor: null }; }
  async listConversations(): Promise<ResourcePage<never>> { return { items: [], hasMore: false, nextCursor: null }; }
  async listMessages(_companyId: number, _conversationId: number, _query: PageQuery) { return null; }
}

class RecordingDeliveryClient implements DeliveryClient {
  async deliver(_request: DeliveryRequest): Promise<DeliveryResult> {
    return { id: "1", external_id: null, status: "sent", timestamp: "2026-08-13T12:00:00.000Z", channel_type: "whatsapp", conversation_id: "1" };
  }
}

class MemoryWebhooks implements WebhookRepository {
  private id = 0;
  async create(_companyId: number, _apiKeyId: number, input: CreateWebhookInput): Promise<WebhookEndpoint> {
    return { id: String(++this.id), url: input.url, event_types: input.eventTypes, active: true, created_at: "2026-08-13T12:00:00.000Z" };
  }
  async list(): Promise<WebhookEndpoint[]> { return []; }
  async disable(): Promise<boolean> { return false; }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeContactsApp() {
  const app = await buildApp({
    apiKeyRepository: new MemoryApiKeys(),
    contactMutationRepository: new MemoryContacts(),
    idempotencyRepository: new MemoryIdempotency(),
    logger: false,
    readOnly: false
  });
  apps.push(app);
  return app;
}

async function makeMessagesApp() {
  const app = await buildApp({
    apiKeyRepository: new MemoryApiKeys(),
    coreRepository: new MemoryCore(),
    deliveryClient: new RecordingDeliveryClient(),
    idempotencyRepository: new MemoryIdempotency(),
    logger: false,
    readOnly: false
  });
  apps.push(app);
  return app;
}

async function makeWebhooksApp() {
  const app = await buildApp({
    apiKeyRepository: new MemoryApiKeys(),
    hostResolver: async () => ["93.184.216.34"],
    logger: false,
    readOnly: false,
    webhookRepository: new MemoryWebhooks()
  });
  apps.push(app);
  return app;
}

describe("global body limit", () => {
  it("accepts a request body well within the conservative global limit", async () => {
    const app = await makeContactsApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/contacts",
      headers: { ...headers, "idempotency-key": "body-limit-ok" },
      payload: { name: "Ana", notes: "a".repeat(1000) }
    });

    expect(response.statusCode).toBe(201);
  });

  it("rejects a request body over the global limit with the canonical 413 envelope", async () => {
    const app = await makeContactsApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/contacts",
      headers: { ...headers, "idempotency-key": "body-limit-too-big" },
      payload: { name: "Ana", notes: "a".repeat(globalBodyLimitBytes + 1024) }
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      error: {
        code: "payload_too_large",
        message: expect.any(String),
        request_id: response.headers["x-request-id"]
      }
    });
  });
});

describe("per-route body limits", () => {
  it("rejects an oversized message body under the tighter route limit even though it fits the global limit", async () => {
    const app = await makeMessagesApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { ...headers, "idempotency-key": "message-too-big" },
      payload: { channel_id: "1", to: "+34600000000", message: "a".repeat(messageBodyLimitBytes + 1024) }
    });

    expect(messageBodyLimitBytes).toBeLessThan(globalBodyLimitBytes);
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("payload_too_large");
  });

  it("rejects an oversized webhook registration body under its tighter route limit", async () => {
    const app = await makeWebhooksApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers,
      payload: {
        url: "https://smartbc.example/webhook",
        event_types: ["message.created"],
        padding: "a".repeat(webhookBodyLimitBytes + 1024)
      }
    });

    expect(webhookBodyLimitBytes).toBeLessThan(globalBodyLimitBytes);
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("payload_too_large");
  });

  it("accepts a webhook registration body within its tighter route limit", async () => {
    const app = await makeWebhooksApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers,
      payload: { url: "https://smartbc.example/webhook", event_types: ["message.created"] }
    });

    expect(response.statusCode).toBe(201);
  });
});
