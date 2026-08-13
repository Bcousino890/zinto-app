import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

const rawKey = `pcp_${"b".repeat(64)}`;
const keyHash = createHash("sha256").update(rawKey.slice(4)).digest("hex");

const writeEnabledRecord: ApiKeyRecord = {
  id: 7,
  companyId: 12,
  companyName: "Empresa de prueba",
  userId: 4,
  name: "Write-enabled partner",
  keyHash,
  permissions: ["contacts:write"],
  isActive: true,
  expiresAt: null,
  allowedIps: []
};

class MemoryApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly record: ApiKeyRecord | null) {}

  async findByHash(hash: string): Promise<ApiKeyRecord | null> {
    return hash === this.record?.keyHash ? this.record : null;
  }

  async markUsed(): Promise<void> {}
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("service health contract", () => {
  it("returns a request-correlated health response without secrets", async () => {
    const app = await buildApp({ logger: false });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toMatch(/^req_[a-f0-9-]+$/);
    expect(response.json()).toEqual({
      data: {
        service: "zinto-integration-api",
        status: "ok",
        version: "0.1.0"
      },
      meta: {
        request_id: response.headers["x-request-id"]
      }
    });
    expect(response.body).not.toContain("DATABASE_URL");
  });

  it("returns the canonical error envelope for an unknown route", async () => {
    const app = await buildApp({ logger: false });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/missing" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "not_found",
        message: "Route not found",
        request_id: response.headers["x-request-id"]
      }
    });
  });

  it("reports readiness only when its dependency check succeeds", async () => {
    const healthy = await buildApp({ logger: false, readinessCheck: async () => undefined });
    const unhealthy = await buildApp({
      logger: false,
      readinessCheck: async () => {
        throw new Error("database unavailable");
      }
    });
    apps.push(healthy, unhealthy);

    const ready = await healthy.inject({ method: "GET", url: "/ready" });
    const unavailable = await unhealthy.inject({ method: "GET", url: "/ready" });

    expect(ready.statusCode).toBe(200);
    expect(ready.json().data.status).toBe("ready");
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({
      error: {
        code: "service_not_ready",
        message: "A required service is unavailable",
        request_id: unavailable.headers["x-request-id"]
      }
    });
  });

  it("blocks every API mutation while read-only mode is enabled", async () => {
    const app = await buildApp({ logger: false });
    apps.push(app);

    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const response = await app.inject({ method, url: "/api/v1/contacts/1" });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("read_only_mode");
    }
  });

  it("still lets an allowlisted API key write while global read-only stays enabled", async () => {
    const app = await buildApp({
      apiKeyRepository: new MemoryApiKeyRepository(writeEnabledRecord),
      logger: false,
      writeEnabledApiKeyIds: new Set([7])
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/contacts/1",
      headers: { authorization: `Bearer ${rawKey}` }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("not_found");
  });

  it("still lets an allowlisted company write while global read-only stays enabled", async () => {
    const app = await buildApp({
      apiKeyRepository: new MemoryApiKeyRepository(writeEnabledRecord),
      logger: false,
      writeEnabledCompanyIds: new Set([12])
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/contacts/1",
      headers: { authorization: `Bearer ${rawKey}` }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("not_found");
  });

  it("closes owned dependencies when the application stops", async () => {
    let closed = false;
    const app = await buildApp({
      logger: false,
      onClose: async () => {
        closed = true;
      }
    });

    await app.close();

    expect(closed).toBe(true);
  });
});
