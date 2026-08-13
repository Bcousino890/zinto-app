import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";
import { DeliveryAdapterError } from "../src/delivery/client.js";
import type { DeliveryClient, DeliveryRequest, DeliveryResult } from "../src/delivery/client.js";
import type {
  IdempotencyRecord,
  IdempotencyRepository,
  IdempotencyScope
} from "../src/http/idempotency.js";
import type { ChannelResource, CoreRepository, PageQuery, ResourcePage } from "../src/resources/core.js";
import type { DeliveryAuditEntry, DeliveryAuditRepository } from "../src/resources/delivery-audit.js";

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
  /** Simulates the adapter's own `TypeError: fetch failed` for a network-level failure. */
  shouldFailToConnect = false;
  rejectWithLegacyStatus: number | null = null;

  async deliver(request: DeliveryRequest): Promise<DeliveryResult> {
    this.requests.push(request);
    if (this.shouldTimeout) throw new DOMException("Timed out", "AbortError");
    if (this.shouldFailToConnect) {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })
      });
    }
    if (this.rejectWithLegacyStatus !== null) {
      throw new DeliveryAdapterError(this.rejectWithLegacyStatus, { success: false });
    }
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

class MemoryDeliveryAudit implements DeliveryAuditRepository {
  entries: DeliveryAuditEntry[] = [];
  shouldFail = false;

  async record(entry: DeliveryAuditEntry): Promise<void> {
    if (this.shouldFail) throw new Error("audit table unavailable");
    this.entries.push(entry);
  }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp(options: { deliveryAudit?: DeliveryAuditRepository } = {}) {
  const delivery = new RecordingDeliveryClient();
  const app = await buildApp({
    apiKeyRepository: new MemoryApiKeys(),
    coreRepository: new MemoryCore(),
    deliveryAuditRepository: options.deliveryAudit,
    deliveryClient: delivery,
    hostResolver: async () => ["93.184.216.34"],
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

  it("refuses a safe media URL when the proxy is not configured, rather than forwarding it raw", async () => {
    // Forwarding the partner URL to the legacy engine unmodified is exactly the
    // rebinding window the media proxy exists to close; silently falling back
    // to it once writes are enabled would reopen that window without anyone
    // flipping a security-relevant flag on purpose.
    const { app, delivery } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send-media",
      headers: { ...baseHeaders, "idempotency-key": "media-no-proxy" },
      payload: { channel_id: "22", to: "+34606806103", media_type: "image", media_url: "https://cdn.partner.example/a.png" }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("media_proxy_disabled");
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

  it("treats a raw network failure from the adapter as an unknown-outcome timeout, not a generic 500", async () => {
    // Before this, a fetch-level failure that was not already an AbortError
    // (refused connection, DNS failure, reset mid-response - anything the
    // adapter's own retry could not prove was safe) fell through every
    // recognized branch and surfaced as a generic 500 internal_error,
    // indistinguishable from a bug in this service.
    const { app, delivery } = await makeApp();
    delivery.shouldFailToConnect = true;
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { ...baseHeaders, "idempotency-key": "smartbc-message-network-failure" },
      payload: { channel_id: "22", to: "+34606806103", message: "Hola" }
    });

    expect(response.statusCode).toBe(504);
    expect(response.json().error.code).toBe("delivery_timeout");
  });

  it("distinguishes a legacy 4xx rejection from a legacy 5xx or unknown failure", async () => {
    const { app, delivery } = await makeApp();

    delivery.rejectWithLegacyStatus = 400;
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { ...baseHeaders, "idempotency-key": "smartbc-legacy-4xx" },
      payload: { channel_id: "22", to: "+34606806103", message: "Hola" }
    });
    expect(rejected.statusCode).toBe(502);
    expect(rejected.json().error.code).toBe("delivery_rejected");

    delivery.rejectWithLegacyStatus = 500;
    const failed = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { ...baseHeaders, "idempotency-key": "smartbc-legacy-5xx" },
      payload: { channel_id: "22", to: "+34606806103", message: "Hola" }
    });
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error.code).toBe("delivery_failed");
  });
});

describe("delivery audit trail", () => {
  it("does nothing when no repository is configured, exactly like before this feature existed", async () => {
    const { app, delivery } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { ...baseHeaders, "idempotency-key": "audit-disabled" },
      payload: { channel_id: "22", to: "+34606806103", message: "Hola" }
    });

    expect(response.statusCode).toBe(201);
    expect(delivery.requests).toHaveLength(1);
  });

  it("records the real actor behind a successful send when a repository is configured", async () => {
    const audit = new MemoryDeliveryAudit();
    const { app } = await makeApp({ deliveryAudit: audit });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { ...baseHeaders, "idempotency-key": "audit-recorded" },
      payload: { channel_id: "22", to: "+34606806103", message: "Hola desde SmartBC" }
    });

    expect(response.statusCode).toBe(201);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toEqual({
      companyId: 12,
      actorUserId: 4,
      action: "message.sent",
      resourceType: "message",
      resourceId: "901",
      payload: {
        channel_id: "22",
        to: "+34606806103",
        kind: "text",
        status: "sent",
        external_id: "wamid.test",
        conversation_id: "501"
      }
    });
  });

  it("does not record anything, and does not replay a duplicate, when idempotency replays the response", async () => {
    const audit = new MemoryDeliveryAudit();
    const { app, delivery } = await makeApp({ deliveryAudit: audit });
    const request = {
      method: "POST" as const,
      url: "/api/v1/messages/send",
      headers: { ...baseHeaders, "idempotency-key": "audit-replayed" },
      payload: { channel_id: "22", to: "+34606806103", message: "Hola" }
    };

    await app.inject(request);
    await app.inject(request);

    expect(delivery.requests).toHaveLength(1);
    expect(audit.entries).toHaveLength(1);
  });

  it("still returns 201 to the partner when the audit write itself fails", async () => {
    // The legacy engine already accepted and is delivering the message by the
    // time this runs; our own bookkeeping failing must never turn that into a
    // failed response.
    const audit = new MemoryDeliveryAudit();
    audit.shouldFail = true;
    const { app } = await makeApp({ deliveryAudit: audit });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send",
      headers: { ...baseHeaders, "idempotency-key": "audit-failure-is-not-fatal" },
      payload: { channel_id: "22", to: "+34606806103", message: "Hola" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.id).toBe("901");
    expect(audit.entries).toHaveLength(0);
  });
});
