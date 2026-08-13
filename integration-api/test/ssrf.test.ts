import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { type AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";
import type { ChannelResource, CoreRepository, ResourcePage } from "../src/resources/core.js";
import type { DeliveryClient, DeliveryRequest, DeliveryResult } from "../src/delivery/client.js";
import type {
  IdempotencyRecord,
  IdempotencyRepository,
  IdempotencyScope
} from "../src/http/idempotency.js";
import type {
  CreateWebhookInput,
  WebhookEndpoint,
  WebhookRepository
} from "../src/webhooks/repository.js";
import { isBlockedIpAddress } from "../src/net/ip-rules.js";
import { assertSafeDestination, UnsafeDestinationError } from "../src/net/destination.js";
import { createSafeFetch } from "../src/net/safe-fetch.js";

const blocked = [
  "0.0.0.0", "0.1.2.3",
  "10.0.0.1", "10.255.255.255",
  "100.64.0.1", "100.127.255.254",
  "127.0.0.1", "127.1.2.3",
  "169.254.169.254",
  "172.16.0.1", "172.31.255.254",
  "192.0.0.1", "192.0.2.5", "192.88.99.1", "192.168.1.1",
  "198.18.0.1", "198.19.255.1", "198.51.100.7", "203.0.113.9",
  "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
  "::", "::1",
  "fc00::1", "fd12:3456:789a::1",
  "fe80::1", "fec0::1", "ff02::1",
  "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:172.16.0.1",
  "::ffff:100.64.0.1", "::ffff:192.168.1.1", "::ffff:7f00:1",
  "64:ff9b::127.0.0.1",
  "2002::1", "2001:db8::1", "100::1"
];

const allowed = [
  "1.1.1.1", "8.8.8.8", "93.184.216.34",
  "172.15.0.1", "172.32.0.1",
  "100.63.255.255", "100.128.0.1",
  "192.0.1.1", "192.1.2.3", "198.20.0.1", "199.0.113.9",
  "2606:4700:4700::1111", "2a00:1450:4001:80f::200e"
];

describe("blocked address classification", () => {
  it.each(blocked)("blocks %s", (address) => {
    expect(isBlockedIpAddress(address)).toBe(true);
  });

  it.each(allowed)("allows %s", (address) => {
    expect(isBlockedIpAddress(address)).toBe(false);
  });

  it("blocks anything that is not a parsable address", () => {
    expect(isBlockedIpAddress("not-an-address")).toBe(true);
    expect(isBlockedIpAddress("")).toBe(true);
  });
});

describe("destination policy", () => {
  const https = { protocols: ["https:"] as const };

  it("rejects a hostname whose only address is private", async () => {
    await expect(assertSafeDestination("https://internal.partner.example/hook", {
      ...https,
      resolve: async () => ["10.1.2.3"]
    })).rejects.toBeInstanceOf(UnsafeDestinationError);
  });

  it("rejects a hostname that mixes a public and a private address", async () => {
    await expect(assertSafeDestination("https://rebind.partner.example/hook", {
      ...https,
      resolve: async () => ["93.184.216.34", "127.0.0.1"]
    })).rejects.toBeInstanceOf(UnsafeDestinationError);
  });

  it("rejects a hostname that resolves to nothing", async () => {
    await expect(assertSafeDestination("https://void.partner.example/hook", {
      ...https,
      resolve: async () => []
    })).rejects.toBeInstanceOf(UnsafeDestinationError);
  });

  it("rejects a hostname whose resolution fails", async () => {
    await expect(assertSafeDestination("https://broken.partner.example/hook", {
      ...https,
      resolve: async () => { throw new Error("ENOTFOUND"); }
    })).rejects.toBeInstanceOf(UnsafeDestinationError);
  });

  it("rejects a literal private address without consulting DNS", async () => {
    await expect(assertSafeDestination("https://169.254.169.254/latest/meta-data", {
      ...https,
      resolve: async () => { throw new Error("DNS must not be used for a literal"); }
    })).rejects.toBeInstanceOf(UnsafeDestinationError);
  });

  it("rejects a disallowed protocol, credentials and a trailing-dot loopback", async () => {
    const resolve = async () => ["93.184.216.34"];
    await expect(assertSafeDestination("http://partner.example/hook", { ...https, resolve }))
      .rejects.toBeInstanceOf(UnsafeDestinationError);
    await expect(assertSafeDestination("https://user:pass@partner.example/hook", { ...https, resolve }))
      .rejects.toBeInstanceOf(UnsafeDestinationError);
    await expect(assertSafeDestination("file:///etc/passwd", { ...https, resolve }))
      .rejects.toBeInstanceOf(UnsafeDestinationError);
    await expect(assertSafeDestination("https://localhost./hook", {
      ...https,
      resolve: async () => ["127.0.0.1"]
    })).rejects.toBeInstanceOf(UnsafeDestinationError);
  });

  it("accepts a public HTTPS destination", async () => {
    await expect(assertSafeDestination("https://partner.example/hook", {
      ...https,
      resolve: async () => ["93.184.216.34", "2606:4700:4700::1111"]
    })).resolves.toBeUndefined();
  });
});

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("safe fetch", () => {
  it("refuses a literal loopback destination under the real policy", async () => {
    const origin = await listen((_request, response) => response.end("reached"));
    const safeFetch = createSafeFetch();
    await expect(safeFetch(new Request(`${origin}/hook`, { method: "POST", body: "{}" })))
      .rejects.toBeInstanceOf(UnsafeDestinationError);
  });

  it("refuses a hostname that resolves to a blocked address", async () => {
    const safeFetch = createSafeFetch({ resolve: async () => ["127.0.0.1"] });
    await expect(safeFetch(new Request("http://rebind.partner.example/hook", { method: "POST", body: "{}" })))
      .rejects.toBeInstanceOf(UnsafeDestinationError);
  });

  it("delivers the exact body and headers to an allowed destination", async () => {
    const seen: { body: string; signature?: string; method: string }[] = [];
    const origin = await listen((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        seen.push({
          body,
          signature: request.headers["x-zinto-signature"] as string | undefined,
          method: request.method ?? ""
        });
        response.statusCode = 200;
        response.end("ok");
      });
    });
    const safeFetch = createSafeFetch({ isAddressBlocked: () => false });
    const response = await safeFetch(new Request(`${origin}/hook`, {
      method: "POST",
      headers: { "x-zinto-signature": "v1=abc" },
      body: "{\"id\":\"evt_1\"}"
    }));

    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    expect(seen).toEqual([{ body: "{\"id\":\"evt_1\"}", signature: "v1=abc", method: "POST" }]);
  });

  it("does not follow redirects by default", async () => {
    let secondaryHits = 0;
    const secondary = await listen((_request, response) => {
      secondaryHits += 1;
      response.end("secret");
    });
    const origin = await listen((_request, response) => {
      response.statusCode = 302;
      response.setHeader("location", `${secondary}/internal`);
      response.end();
    });
    const safeFetch = createSafeFetch({ isAddressBlocked: () => false });
    const response = await safeFetch(new Request(`${origin}/hook`, { method: "POST", body: "{}" }));

    expect(response.status).toBe(302);
    expect(response.ok).toBe(false);
    expect(secondaryHits).toBe(0);
  });

  it("revalidates every redirect hop and refuses one pointing at a blocked address", async () => {
    let secondaryHits = 0;
    const secondary = await listen((_request, response) => {
      secondaryHits += 1;
      response.end("secret");
    });
    const origin = await listen((_request, response) => {
      response.statusCode = 302;
      response.setHeader("location", `${secondary}/internal`);
      response.end();
    });
    // The first hop is permitted, every later hop is treated as blocked, so the
    // redirect target must be re-checked instead of inheriting the first verdict.
    let hop = 0;
    const safeFetch = createSafeFetch({
      maxRedirects: 3,
      isAddressBlocked: () => { hop += 1; return hop > 1; }
    });

    await expect(safeFetch(new Request(`${origin}/hook`, { method: "POST", body: "{}" })))
      .rejects.toBeInstanceOf(UnsafeDestinationError);
    expect(hop).toBe(2);
    expect(secondaryHits).toBe(0);
  });

  it("refuses a redirect to a non-HTTP protocol", async () => {
    const origin = await listen((_request, response) => {
      response.statusCode = 302;
      response.setHeader("location", "file:///etc/passwd");
      response.end();
    });
    const safeFetch = createSafeFetch({ maxRedirects: 3, isAddressBlocked: () => false });
    await expect(safeFetch(new Request(`${origin}/hook`, { method: "POST", body: "{}" })))
      .rejects.toBeInstanceOf(UnsafeDestinationError);
  });

  it("stops after the redirect budget is exhausted", async () => {
    let hits = 0;
    const origin = await listen((_request, response) => {
      hits += 1;
      response.statusCode = 302;
      response.setHeader("location", "/again");
      response.end();
    });
    const safeFetch = createSafeFetch({ maxRedirects: 2, isAddressBlocked: () => false });
    await expect(safeFetch(new Request(`${origin}/hook`, { method: "POST", body: "{}" })))
      .rejects.toBeInstanceOf(UnsafeDestinationError);
    expect(hits).toBe(3);
  });
});

const rawKey = `pcp_${"c".repeat(64)}`;
const keyHash = createHash("sha256").update(rawKey.slice(4)).digest("hex");
const headers = { authorization: `Bearer ${rawKey}`, "idempotency-key": "idem-ssrf-1" };
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

const apiKey: ApiKeyRecord = {
  id: 21,
  companyId: 22,
  companyName: "Empresa de prueba",
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

class MemoryWebhooks implements WebhookRepository {
  async create(_companyId: number, _apiKeyId: number, input: CreateWebhookInput): Promise<WebhookEndpoint> {
    return {
      id: "1",
      url: input.url,
      event_types: input.eventTypes,
      active: true,
      created_at: "2026-08-13T14:00:00.000Z"
    };
  }
  async list() { return []; }
  async disable() { return false; }
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

const channel: ChannelResource = {
  id: "5",
  name: "WhatsApp Chile",
  type: "whatsapp",
  status: "connected",
  capabilities: ["text", "media"]
};

class MemoryCore implements CoreRepository {
  async listChannels() { return [channel]; }
  async listContacts(): Promise<ResourcePage<never>> { return { items: [], hasMore: false, nextCursor: null }; }
  async listConversations(): Promise<ResourcePage<never>> { return { items: [], hasMore: false, nextCursor: null }; }
  async listMessages() { return null; }
}

class RecordingDelivery implements DeliveryClient {
  calls: DeliveryRequest[] = [];
  async deliver(request: DeliveryRequest): Promise<DeliveryResult> {
    this.calls.push(request);
    return {
      id: "1", external_id: null, status: "sent",
      timestamp: "2026-08-13T14:00:00.000Z",
      channel_type: "whatsapp", conversation_id: "9"
    };
  }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp(resolve: (hostname: string) => Promise<string[]>) {
  const delivery = new RecordingDelivery();
  const app = await buildApp({
    apiKeyRepository: new MemoryApiKeys(),
    coreRepository: new MemoryCore(),
    deliveryClient: delivery,
    hostResolver: resolve,
    idempotencyRepository: new MemoryIdempotency(),
    logger: false,
    readOnly: false,
    webhookRepository: new MemoryWebhooks()
  });
  apps.push(app);
  return { app, delivery };
}

describe("SSRF defence on public routes", () => {
  it("rejects a webhook URL whose hostname resolves to loopback", async () => {
    const { app } = await makeApp(async () => ["127.0.0.1"]);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers,
      payload: { url: "https://hook.partner.example/zinto", event_types: ["message.created"] }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("unsafe_webhook_url");
  });

  it("rejects a webhook URL whose hostname resolves to cloud metadata", async () => {
    const { app } = await makeApp(async () => ["169.254.169.254"]);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers,
      payload: { url: "https://hook.partner.example/zinto", event_types: ["message.created"] }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("unsafe_webhook_url");
  });

  it("accepts a webhook URL that resolves to a public address", async () => {
    const { app } = await makeApp(async () => ["93.184.216.34"]);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers,
      payload: { url: "https://hook.partner.example/zinto", event_types: ["message.created"] }
    });

    expect(response.statusCode).toBe(201);
  });

  it("rejects media whose hostname resolves to a CGNAT address and never calls delivery", async () => {
    const { app, delivery } = await makeApp(async () => ["100.64.0.7"]);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send-media",
      headers,
      payload: {
        channel_id: "5",
        to: "+56911112222",
        media_type: "image",
        media_url: "https://cdn.partner.example/a.png"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("unsafe_media_url");
    expect(delivery.calls).toEqual([]);
  });

  it("rejects media whose hostname mixes public and private addresses", async () => {
    const { app, delivery } = await makeApp(async () => ["93.184.216.34", "192.168.1.5"]);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send-media",
      headers,
      payload: {
        channel_id: "5",
        to: "+56911112222",
        media_type: "image",
        media_url: "https://cdn.partner.example/a.png"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(delivery.calls).toEqual([]);
  });

  it("accepts media served from a public address", async () => {
    const { app, delivery } = await makeApp(async () => ["93.184.216.34"]);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send-media",
      headers,
      payload: {
        channel_id: "5",
        to: "+56911112222",
        media_type: "image",
        media_url: "https://cdn.partner.example/a.png"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(delivery.calls).toHaveLength(1);
  });
});
