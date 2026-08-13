import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { DeliveryAdapterError, LegacyDeliveryClient } from "../src/delivery/client.js";
import { secureLoggerOptions } from "../src/http/logging.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  globalThis.fetch = originalFetch;
});

function refusedConnectionError(): TypeError {
  // The exact shape Node's fetch (undici) throws for a failure before any
  // response exists, verified against this runtime by connecting to a closed
  // port and to an unresolvable host (see src/delivery/client.ts).
  return Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" })
  });
}

function legacySuccessResponse(): Response {
  return new Response(JSON.stringify({
    success: true,
    data: {
      id: 5001,
      status: "sent",
      timestamp: "2026-08-13T10:00:00.000Z",
      channelType: "whatsapp",
      conversationId: 900
    }
  }), { status: 200, headers: { "content-type": "application/json" } });
}

const sampleRequest = {
  kind: "text" as const,
  bearerToken: "test-token",
  channelId: 1,
  to: "+34600000000",
  message: "hola"
};

describe("DeliveryAdapterError", () => {
  it("does not expose the raw legacy response through plain object enumeration", () => {
    const marker = "customer-phone-should-not-leak-+34600000000";
    const error = new DeliveryAdapterError(502, { data: { to: marker, secret: "should-not-leak-either" } });

    expect(Object.keys(error)).not.toContain("response");
    expect(JSON.stringify(error)).not.toContain(marker);
    // The data is still reachable for legitimate direct access, just not via
    // a generic for...in / spread copy such as pino's default `err` serializer.
    expect(error.response).toEqual({ data: { to: marker, secret: "should-not-leak-either" } });
  });

  it("keeps the raw legacy response out of a log line if it ever reaches a generic error log", async () => {
    const chunks: string[] = [];
    const stream = { write(chunk: string) { chunks.push(chunk); } };
    const app = await buildApp({ logger: { ...secureLoggerOptions("info"), stream } });
    apps.push(app);

    const marker = "customer-message-should-not-leak-hola-cliente";
    const error = new DeliveryAdapterError(502, { data: { message: marker } });
    app.log.error({ err: error }, "legacy delivery adapter error reached the generic handler");

    expect(chunks.join("")).not.toContain(marker);
  });
});

describe("LegacyDeliveryClient retry on a pre-connection failure", () => {
  it("retries exactly once after a refused connection, then succeeds", async () => {
    const client = new LegacyDeliveryClient("http://legacy.invalid", 5_000);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) throw refusedConnectionError();
      return legacySuccessResponse();
    }) as typeof fetch;

    const result = await client.deliver(sampleRequest);

    expect(calls).toBe(2);
    expect(result).toEqual({
      id: "5001",
      external_id: null,
      status: "sent",
      timestamp: "2026-08-13T10:00:00.000Z",
      channel_type: "whatsapp",
      conversation_id: "900"
    });
  });

  it("gives up after a second refused connection, without a third attempt", async () => {
    const client = new LegacyDeliveryClient("http://legacy.invalid", 5_000);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw refusedConnectionError();
    }) as typeof fetch;

    await expect(client.deliver(sampleRequest)).rejects.toThrow("fetch failed");
    expect(calls).toBe(2);
  });

  it("does not retry once a response was already received, even a rejection", async () => {
    const client = new LegacyDeliveryClient("http://legacy.invalid", 5_000);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ success: false }), { status: 500 });
    }) as typeof fetch;

    await expect(client.deliver(sampleRequest)).rejects.toBeInstanceOf(DeliveryAdapterError);
    expect(calls).toBe(1);
  });

  it("does not retry a connection reset that happens after the socket was already established", async () => {
    // Unlike ECONNREFUSED/ENOTFOUND, a reset can happen after bytes were
    // already written to the legacy engine; retrying could duplicate a real
    // WhatsApp/SMS/etc. send, so this must propagate untouched.
    const client = new LegacyDeliveryClient("http://legacy.invalid", 5_000);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })
      });
    }) as typeof fetch;

    await expect(client.deliver(sampleRequest)).rejects.toThrow("fetch failed");
    expect(calls).toBe(1);
  });

  it("does not retry its own timeout", async () => {
    const client = new LegacyDeliveryClient("http://legacy.invalid", 5_000);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new DOMException("The operation was aborted", "TimeoutError");
    }) as typeof fetch;

    await expect(client.deliver(sampleRequest)).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("surfaces a real refused connection on an unused local port the same way, without mocking fetch", async () => {
    // Cross-check against the real network stack rather than only the mocked
    // shape above: bind a server to get a genuinely free port, close it
    // immediately so nothing listens there, and confirm a real connection
    // attempt fails exactly the way the mocked tests above assume.
    const probe: Server = createServer();
    const port = await new Promise<number>((resolve) => {
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const client = new LegacyDeliveryClient(`http://127.0.0.1:${port}`, 5_000);
    await expect(client.deliver(sampleRequest)).rejects.toThrow("fetch failed");
  });
});
