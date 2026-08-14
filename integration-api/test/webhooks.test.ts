import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

const dns = vi.hoisted(() => ({
  lookup: vi.fn()
}));

vi.mock("node:dns/promises", () => dns);

import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";
import { signWebhook } from "../src/webhooks/signature.js";
import type {
  CreateWebhookInput,
  WebhookEndpoint,
  WebhookRepository
} from "../src/webhooks/repository.js";

const rawKey = `pcp_${"e".repeat(64)}`;
const keyHash = createHash("sha256").update(rawKey.slice(4)).digest("hex");
const headers = { authorization: `Bearer ${rawKey}` };
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

const apiKey: ApiKeyRecord = {
  id: 11,
  companyId: 12,
  companyName: "Empresa de prueba",
  userId: 4,
  name: "Partner integration",
  keyHash,
  permissions: ["webhooks:manage"],
  isActive: true,
  expiresAt: null,
  allowedIps: []
};

class MemoryApiKeys implements ApiKeyRepository {
  async findByHash(hash: string) { return hash === keyHash ? apiKey : null; }
  async markUsed() {}
}

class MemoryWebhooks implements WebhookRepository {
  endpoints = new Map<number, WebhookEndpoint & { companyId: number; secret: string }>();
  private id = 0;

  async create(companyId: number, apiKeyId: number, input: CreateWebhookInput) {
    const id = ++this.id;
    const endpoint = {
      id: String(id),
      companyId,
      url: input.url,
      event_types: input.eventTypes,
      active: true,
      created_at: "2026-08-13T14:00:00.000Z",
      secret: input.secret
    };
    this.endpoints.set(id, endpoint);
    const { companyId: _companyId, secret: _secret, ...resource } = endpoint;
    return resource;
  }

  async list(companyId: number) {
    return [...this.endpoints.values()]
      .filter((item) => item.companyId === companyId)
      .map(({ companyId: _companyId, secret: _secret, ...resource }) => resource);
  }

  async disable(companyId: number, endpointId: number) {
    const current = this.endpoints.get(endpointId);
    if (current === undefined || current.companyId !== companyId) return false;
    this.endpoints.set(endpointId, { ...current, active: false });
    return true;
  }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  dns.lookup.mockReset();
});

// Registration now resolves DNS, so the suite states what each test hostname
// answers instead of depending on the machine running the tests.
const resolveTestHost = async (hostname: string): Promise<string[]> => {
  const values = await dns.lookup(hostname, { all: true, verbatim: true });
  return values.map((value: { address: string }) => value.address);
};

async function makeApp(options: {
  readOnly?: boolean;
  writeEnabledApiKeyIds?: number[];
  writeEnabledCompanyIds?: number[];
} = {}) {
  dns.lookup.mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }
  ]);
  const repository = new MemoryWebhooks();
  const app = await buildApp({
    apiKeyRepository: new MemoryApiKeys(),
    hostResolver: resolveTestHost,
    logger: false,
    readOnly: options.readOnly ?? false,
    writeEnabledApiKeyIds: new Set(options.writeEnabledApiKeyIds ?? []),
    writeEnabledCompanyIds: new Set(options.writeEnabledCompanyIds ?? []),
    webhookRepository: repository
  });
  apps.push(app);
  return { app, repository };
}

describe("webhook signatures", () => {
  it("signs the timestamp and exact raw body with HMAC-SHA256", () => {
    expect(signWebhook("1786629600", "{\"event\":\"message.created\"}", "whsec_test"))
      .toBe("v1=4c4c79d1123f0ccdf8c0451259f53a3fa7c3d5f784e56092bdf7591d0f92c84e");
  });
});

describe("webhook endpoints", () => {
  it("keeps listing webhooks readable while read-only is enabled and no allowlist is configured", async () => {
    const { app } = await makeApp({ readOnly: true });
    const response = await app.inject({ method: "GET", url: "/api/v1/webhooks", headers });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([]);
  });

  it("blocks webhook creation in global read-only mode when no allowlist is configured", async () => {
    const { app } = await makeApp({ readOnly: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers,
      payload: {
        url: "https://smartbc.example/webhooks/zinto",
        event_types: ["message.created"]
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("read_only_mode");
  });

  it("allows an allowlisted api key to manage webhooks while global read-only stays enabled", async () => {
    const { app } = await makeApp({
      readOnly: true,
      writeEnabledApiKeyIds: [apiKey.id]
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers,
      payload: {
        url: "https://smartbc.example/webhooks/zinto",
        event_types: ["message.created"]
      }
    });

    expect(response.statusCode).toBe(201);
  });

  it("creates an HTTPS endpoint and returns its secret exactly once", async () => {
    const { app, repository } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers,
      payload: {
        url: "https://smartbc.example/webhooks/zinto",
        event_types: ["message.created", "contact.updated"]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toEqual(expect.objectContaining({
      id: "1",
      url: "https://smartbc.example/webhooks/zinto",
      secret: expect.stringMatching(/^whsec_[a-f0-9]{64}$/)
    }));
    const list = await app.inject({ method: "GET", url: "/api/v1/webhooks", headers });
    expect(list.body).not.toContain("whsec_");
    expect(repository.endpoints.get(1)?.companyId).toBe(12);
  });

  it.each([
    "http://smartbc.example/webhook",
    "https://127.0.0.1/webhook",
    "https://localhost/webhook"
  ])("rejects an unsafe webhook URL: %s", async (url) => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers,
      payload: { url, event_types: ["message.created"] }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("unsafe_webhook_url");
  });

  it.each([
    { address: "0.0.0.0", family: 4 },
    { address: "10.0.0.7", family: 4 },
    { address: "100.64.0.7", family: 4 },
    { address: "127.0.0.1", family: 4 },
    { address: "169.254.169.254", family: 4 },
    { address: "172.16.0.7", family: 4 },
    { address: "192.168.0.7", family: 4 },
    { address: "198.51.100.9", family: 4 },
    { address: "224.0.0.7", family: 4 },
    { address: "::", family: 6 },
    { address: "::1", family: 6 },
    { address: "::ffff:127.0.0.1", family: 6 },
    { address: "fd00::7", family: 6 },
    { address: "fe80::7", family: 6 },
    { address: "ff02::1", family: 6 },
    { address: "2001:db8::7", family: 6 }
  ])("rejects a webhook hostname resolving to $address", async (resolved) => {
    const { app, repository } = await makeApp();
    dns.lookup.mockResolvedValue([resolved]);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers,
      payload: { url: "https://rebind.example/webhook", event_types: ["message.created"] }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("unsafe_webhook_url");
    expect(repository.endpoints.size).toBe(0);
  });

  it("rejects a mixed DNS answer if any IPv4 or IPv6 address is not public", async () => {
    const { app, repository } = await makeApp();
    dns.lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "fc00::1", family: 6 }
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers,
      payload: { url: "https://mixed.example/webhook", event_types: ["message.created"] }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("unsafe_webhook_url");
    expect(repository.endpoints.size).toBe(0);
  });

  it("rejects unsupported event types", async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers,
      payload: { url: "https://smartbc.example/webhook", event_types: ["admin.password.changed"] }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
  });

  it("accepts installed deal, pipeline, ERP, and Flow events", async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers,
      payload: {
        url: "https://smartbc.example/webhook",
        event_types: [
          "deal.stage.changed",
          "pipeline.stage.updated",
          "task.completed",
          "erp.invoice.updated",
          "flow.execution.completed"
        ]
      }
    });

    expect(response.statusCode).toBe(201);
  });

  it("hides an endpoint belonging to another company", async () => {
    const { app, repository } = await makeApp();
    await repository.create(99, 99, {
      url: "https://other.example/webhook",
      eventTypes: ["message.created"],
      secret: `whsec_${"f".repeat(64)}`
    });
    const response = await app.inject({
      method: "DELETE",
      url: "/api/v1/webhooks/1",
      headers
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("webhook_not_found");
  });
});
