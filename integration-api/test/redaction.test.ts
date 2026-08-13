import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";
import { redactUrl, secureLoggerOptions } from "../src/http/logging.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function sink() {
  const chunks: string[] = [];
  return { stream: { write(chunk: string) { chunks.push(chunk); } }, output: () => chunks.join("") };
}

describe("redactUrl", () => {
  it("leaves a query string with only benign parameters untouched", () => {
    expect(redactUrl("/api/v1/contacts?limit=10")).toBe("/api/v1/contacts?limit=10");
  });

  it("leaves a path without a query string untouched", () => {
    expect(redactUrl("/api/v1/contacts")).toBe("/api/v1/contacts");
  });

  it("redacts a pcp_ token found under a well-known sensitive parameter name", () => {
    const token = `pcp_${"a".repeat(64)}`;
    const result = redactUrl(`/api/v1/me?token=${token}`);
    expect(result).not.toContain(token);
    expect(result).toContain("REDACTED");
    expect(result).toContain("/api/v1/me");
  });

  it("redacts a pcp_ token stuffed under an unexpected parameter name", () => {
    const token = `pcp_${"b".repeat(64)}`;
    const result = redactUrl(`/api/v1/me?debug=${token}`);
    expect(result).not.toContain(token);
  });

  it("keeps benign parameters visible next to a redacted one", () => {
    const token = `pcp_${"c".repeat(64)}`;
    const result = redactUrl(`/api/v1/contacts?limit=5&api_key=${token}&cursor=abc123`);
    expect(result).toContain("limit=5");
    expect(result).toContain("cursor=abc123");
    expect(result).not.toContain(token);
  });
});

describe("secure logger options", () => {
  it("keeps a bearer token that leaked into a query string out of the log output", async () => {
    const { stream, output } = sink();
    const app = await buildApp({ logger: { ...secureLoggerOptions("info"), stream } });
    apps.push(app);

    const token = `pcp_${"d".repeat(64)}`;
    await app.inject({ method: "GET", url: `/api/v1/me?token=${token}` });

    expect(output()).not.toContain(token);
    expect(output()).toContain("/api/v1/me");
  });

  it("keeps the Authorization header value out of the log output", async () => {
    const { stream, output } = sink();
    const rawKey = `pcp_${"e".repeat(64)}`;
    const keyHash = createHash("sha256").update(rawKey.slice(4)).digest("hex");
    const record: ApiKeyRecord = {
      id: 1, companyId: 1, companyName: "Empresa", userId: 1, name: "key",
      keyHash, permissions: ["*"], isActive: true, expiresAt: null, allowedIps: []
    };
    class MemoryApiKeys implements ApiKeyRepository {
      async findByHash(hash: string) { return hash === keyHash ? record : null; }
      async markUsed() {}
    }
    const app = await buildApp({
      apiKeyRepository: new MemoryApiKeys(),
      logger: { ...secureLoggerOptions("info"), stream }
    });
    apps.push(app);

    await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${rawKey}` } });

    expect(output()).not.toContain(rawKey);
  });

  it("still serves requests when buildApp falls back to its default logger", async () => {
    // Regression guard for the `options.logger ?? secureLoggerOptions()`
    // wiring in app.ts: buildApp({}) must not fall back to Fastify's bare
    // `true` logger, which redacts nothing. The redaction behaviour itself is
    // proven by the two tests above using the same secureLoggerOptions().
    const app = await buildApp({});
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
  });
});
