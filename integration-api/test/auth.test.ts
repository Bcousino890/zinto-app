import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import {
  assertScopes,
  type ApiKeyRecord,
  type ApiKeyRepository
} from "../src/auth/api-key.js";

const rawKey = `pcp_${"a".repeat(64)}`;
const keyHash = createHash("sha256").update(rawKey.slice(4)).digest("hex");
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

class MemoryApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly record: ApiKeyRecord | null) {}

  async findByHash(hash: string): Promise<ApiKeyRecord | null> {
    return hash === this.record?.keyHash ? this.record : null;
  }

  async markUsed(): Promise<void> {}
}

const validRecord: ApiKeyRecord = {
  id: 7,
  companyId: 12,
  companyName: "Empresa de prueba",
  userId: 4,
  name: "SmartBC integration",
  keyHash,
  permissions: ["contacts:read", "messages:send"],
  isActive: true,
  expiresAt: null,
  allowedIps: []
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp(record: ApiKeyRecord | null) {
  const app = await buildApp({
    apiKeyRepository: new MemoryApiKeyRepository(record),
    logger: false
  });
  apps.push(app);
  return app;
}

function expectApiError(
  response: Awaited<ReturnType<Awaited<ReturnType<typeof makeApp>>["inject"]>>,
  statusCode: number,
  code: string,
  message: string
): void {
  expect(response.statusCode).toBe(statusCode);
  expect(response.json()).toEqual({
    error: {
      code,
      message,
      request_id: response.headers["x-request-id"]
    }
  });
}

describe("API-key authentication", () => {
  it("rejects a missing authorization header", async () => {
    const app = await makeApp(validRecord);
    const response = await app.inject({ method: "GET", url: "/api/v1/me" });

    expectApiError(response, 401, "missing_api_key", "A Bearer API key is required");
  });

  it.each([
    "Basic abc",
    "Bearer not-a-zinto-key",
    `Bearer pcp_${"g".repeat(64)}`,
    `Bearer ${rawKey} extra`
  ])("rejects a malformed authorization value: %s", async (authorization) => {
    const app = await makeApp(validRecord);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization }
    });

    expectApiError(response, 401, "invalid_api_key", "The API key is invalid");
  });

  it("rejects an unknown API key", async () => {
    const app = await makeApp(null);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${rawKey}` }
    });

    expectApiError(response, 401, "invalid_api_key", "The API key is invalid");
  });

  it("rejects an inactive API key", async () => {
    const app = await makeApp({ ...validRecord, isActive: false });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${rawKey}` }
    });

    expectApiError(response, 401, "api_key_inactive", "The API key is inactive");
  });

  it("rejects an expired API key", async () => {
    const app = await makeApp({ ...validRecord, expiresAt: new Date("2026-01-01T00:00:00Z") });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${rawKey}` }
    });

    expectApiError(response, 401, "api_key_expired", "The API key has expired");
  });

  it("rejects a valid key used from a non-allowlisted IP", async () => {
    const app = await makeApp({ ...validRecord, allowedIps: ["203.0.113.10"] });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${rawKey}` },
      remoteAddress: "198.51.100.4"
    });

    expectApiError(response, 403, "ip_not_allowed", "This IP address is not allowed");
  });

  it("returns tenant identity and scopes without key material", async () => {
    const app = await makeApp(validRecord);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${rawKey}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        api_key: { id: "7", name: "SmartBC integration" },
        company: { id: "12", name: "Empresa de prueba" },
        scopes: ["contacts:read", "messages:send"]
      },
      meta: { request_id: response.headers["x-request-id"] }
    });
    expect(response.body).not.toContain(rawKey);
    expect(response.body).not.toContain(keyHash);
  });
});

describe("scope authorization", () => {
  it("accepts an explicitly granted scope", () => {
    expect(() => assertScopes(validRecord.permissions, ["contacts:read"])).not.toThrow();
  });

  it("accepts the trusted wildcard scope", () => {
    expect(() => assertScopes(["*"], ["messages:send"])).not.toThrow();
  });

  it("rejects a missing required scope", () => {
    expect(() => assertScopes(validRecord.permissions, ["contacts:write"])).toThrowError(
      expect.objectContaining({ code: "insufficient_scope", statusCode: 403 })
    );
  });
});
