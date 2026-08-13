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
import type { ChannelResource, CoreRepository, PageQuery, ResourcePage } from "../src/resources/core.js";

const rawKey = `pcp_${"d".repeat(64)}`;
const keyHash = createHash("sha256").update(rawKey.slice(4)).digest("hex");
const baseHeaders = { authorization: `Bearer ${rawKey}` };
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

const apiKey: ApiKeyRecord = {
  id: 10,
  companyId: 12,
  companyName: "Empresa de prueba",
  userId: 4,
  name: "Partner integration",
  keyHash,
  permissions: ["messages:send", "channels:read"],
  isActive: true,
  expiresAt: null,
  allowedIps: []
};

class MemoryApiKeys implements ApiKeyRepository {
  async findByHash(hash: string) { return hash === keyHash ? apiKey : null; }
  async markUsed() {}
}

class MemoryIdempotency implements IdempotencyRepository {
  records = new Map<string, IdempotencyRecord>();
  private locks = new Map<string, Promise<void>>();
  private key(scope: IdempotencyScope) {
    return `${scope.apiKeyId}:${scope.method}:${scope.path}:${scope.key}`;
  }
  async find(scope: IdempotencyScope) { return this.records.get(this.key(scope)) ?? null; }
  async save(scope: IdempotencyScope, record: IdempotencyRecord) {
    this.records.set(this.key(scope), record);
  }
  async runExclusive<T>(scope: IdempotencyScope, operation: () => Promise<T>): Promise<T> {
    const key = this.key(scope);
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.locks.set(key, queued);
    await previous;
    try { return await operation(); }
    finally {
      release();
      if (this.locks.get(key) === queued) this.locks.delete(key);
    }
  }
}

const channels: ChannelResource[] = [
  { id: "22", type: "whatsapp", name: "WhatsApp ESPAÑA", status: "active", capabilities: ["text", "media"] },
  { id: "23", type: "whatsapp_official", name: "WhatsApp Oficial", status: "active", capabilities: ["text", "media", "template", "interactive"] },
  { id: "24", type: "email", name: "Correo", status: "inactive", capabilities: ["text", "html", "attachments"] }
];

class MemoryCore implements CoreRepository {
  async listChannels(companyId: number) { return companyId === 12 ? channels : []; }
  async listContacts(): Promise<ResourcePage<never>> { return { items: [], hasMore: false, nextCursor: null }; }
  async listConversations(): Promise<ResourcePage<never>> { return { items: [], hasMore: false, nextCursor: null }; }
  async listMessages(_companyId: number, _conversationId: number, _query: PageQuery) { return null; }
}

class RecordingDeliveryClient implements DeliveryClient {
  requests: DeliveryRequest[] = [];
  shouldTimeout = false;

  async deliver(request: DeliveryRequest): Promise<DeliveryResult> {
    this.requests.push(request);
    if (this.shouldTimeout) throw new DOMException("Timed out", "AbortError");
    return {
      id: "901",
      external_id: "wamid.test",
      status: "sent",
      timestamp: "2026-08-13T13:00:00.000Z",
      channel_type: request.kind === "template" ? "whatsapp_official" : "whatsapp",
      conversation_id: "501"
    };
  }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp() {
  const delivery = new RecordingDeliveryClient();
  const app = await buildApp({
    apiKeyRepository: new MemoryApiKeys(),
    coreRepository: new MemoryCore(),
    deliveryClient: delivery,
    idempotencyRepository: new MemoryIdempotency(),
    logger: false,
    readOnly: false
  });
  apps.push(app);
  return { app, delivery };
}

describe("message delivery adapter", () => {
  it("requires idempotency before delegating a text message", async () => {
    const { app, delivery } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: baseHeaders,
      payload: { channel_id: "22", to: "+34606806103", message: "Hola" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("idempotency_key_required");
    expect(delivery.requests).toHaveLength(0);
  });

  it("sends once through an active tenant channel and normalizes the result", async () => {
    const { app, delivery } = await makeApp();
    const request = {
      method: "POST" as const,
      url: "/api/v1/messages/send",
      headers: { ...baseHeaders, "idempotency-key": "smartbc-message-001" },
      payload: { channel_id: "22", to: "+34606806103", message: "Hola desde SmartBC" }
    };

    const first = await app.inject(request);
    const replay = await app.inject(request);

    expect(first.statusCode).toBe(201);
    expect(first.json().data).toEqual({
      id: "901",
      external_id: "wamid.test",
      status: "sent",
      timestamp: "2026-08-13T13:00:00.000Z",
      channel_type: "whatsapp",
      conversation_id: "501"
    });
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(delivery.requests).toHaveLength(1);
    expect(delivery.requests[0]).toEqual(expect.objectContaining({
      bearerToken: rawKey,
      channelId: 22,
      kind: "text",
      to: "+34606806103"
    }));
  });

  it("hides a channel that is not owned by the company", async () => {
    const { app, delivery } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { ...baseHeaders, "idempotency-key": "smartbc-message-002" },
      payload: { channel_id: "999", to: "+34606806103", message: "Hola" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("channel_not_found");
    expect(delivery.requests).toHaveLength(0);
  });

  it("rejects an inactive channel", async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { ...baseHeaders, "idempotency-key": "smartbc-message-003" },
      payload: { channel_id: "24", to: "cliente@example.test", message: "Hola" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("channel_inactive");
  });

  it("rejects a template on an unofficial WhatsApp channel", async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send-template",
      headers: { ...baseHeaders, "idempotency-key": "smartbc-template-001" },
      payload: { channel_id: "22", to: "+34606806103", template_name: "bienvenida" }
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("channel_capability_unsupported");
  });

  it.each([
    "http://127.0.0.1/private.jpg",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.5/file.pdf",
    "http://[::1]/file.pdf"
  ])("rejects a private media URL: %s", async (mediaUrl) => {
    const { app, delivery } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send-media",
      headers: { ...baseHeaders, "idempotency-key": `media-${Buffer.from(mediaUrl).toString("base64url")}` },
      payload: { channel_id: "22", to: "+34606806103", media_type: "image", media_url: mediaUrl }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("unsafe_media_url");
    expect(delivery.requests).toHaveLength(0);
  });

  it("normalizes an adapter timeout without retrying an ambiguous send", async () => {
    const { app, delivery } = await makeApp();
    delivery.shouldTimeout = true;
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { ...baseHeaders, "idempotency-key": "smartbc-message-timeout" },
      payload: { channel_id: "22", to: "+34606806103", message: "Hola" }
    });

    expect(response.statusCode).toBe(504);
    expect(response.json().error.code).toBe("delivery_timeout");
    expect(delivery.requests).toHaveLength(1);
  });
});
