import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ApiKeyRecord, ApiKeyRepository } from "../src/auth/api-key.js";
import { defaultRateLimitConfig, RateLimiter } from "../src/http/rate-limit.js";

describe("RateLimiter (unit)", () => {
  it("allows requests up to the configured maximum and rejects the next one", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, perKeyMax: 2, perCompanyMax: 100, perIpMax: 100 });

    expect(limiter.checkApiKey(1)).toBeNull();
    expect(limiter.checkApiKey(1)).toBeNull();
    expect(limiter.checkApiKey(1)).not.toBeNull();
  });

  it("returns a Retry-After in whole seconds matching the remaining window", () => {
    let now = 1_000_000;
    const limiter = new RateLimiter({ windowMs: 10_000, perKeyMax: 1, perCompanyMax: 100, perIpMax: 100 }, () => now);

    expect(limiter.checkApiKey(1)).toBeNull();
    now += 4_000; // 6s left in the window
    expect(limiter.checkApiKey(1)).toBe(6);
  });

  it("resets the window once it elapses", () => {
    let now = 0;
    const limiter = new RateLimiter({ windowMs: 1_000, perKeyMax: 1, perCompanyMax: 100, perIpMax: 100 }, () => now);

    expect(limiter.checkApiKey(1)).toBeNull();
    expect(limiter.checkApiKey(1)).not.toBeNull();
    now = 1_001;
    expect(limiter.checkApiKey(1)).toBeNull();
  });

  it("keeps separate buckets per API key, company, and IP", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, perKeyMax: 1, perCompanyMax: 1, perIpMax: 1 });

    expect(limiter.checkApiKey(1)).toBeNull();
    expect(limiter.checkApiKey(2)).toBeNull(); // a different key is not affected
    expect(limiter.checkCompany(10)).toBeNull();
    expect(limiter.checkCompany(20)).toBeNull(); // a different company is not affected
    expect(limiter.checkIp("1.2.3.4")).toBeNull();
    expect(limiter.checkIp("5.6.7.8")).toBeNull(); // a different IP is not affected
  });

  it("ships with sane, documented defaults", () => {
    expect(defaultRateLimitConfig.windowMs).toBeGreaterThan(0);
    expect(defaultRateLimitConfig.perKeyMax).toBeGreaterThan(0);
    expect(defaultRateLimitConfig.perIpMax).toBeGreaterThanOrEqual(defaultRateLimitConfig.perKeyMax);
    expect(defaultRateLimitConfig.perCompanyMax).toBeGreaterThanOrEqual(defaultRateLimitConfig.perIpMax);
  });
});

const keyA = `pcp_${"a".repeat(64)}`;
const keyB = `pcp_${"b".repeat(64)}`;
const keyC = `pcp_${"c".repeat(64)}`;
const hash = (rawKey: string) => createHash("sha256").update(rawKey.slice(4)).digest("hex");

const records: ApiKeyRecord[] = [
  { id: 1, companyId: 1, companyName: "Empresa 1", userId: 1, name: "A", keyHash: hash(keyA), permissions: ["*"], isActive: true, expiresAt: null, allowedIps: [] },
  { id: 2, companyId: 1, companyName: "Empresa 1", userId: 1, name: "B", keyHash: hash(keyB), permissions: ["*"], isActive: true, expiresAt: null, allowedIps: [] },
  { id: 3, companyId: 2, companyName: "Empresa 2", userId: 1, name: "C", keyHash: hash(keyC), permissions: ["*"], isActive: true, expiresAt: null, allowedIps: [] }
];

class MemoryApiKeys implements ApiKeyRepository {
  async findByHash(keyHash: string) { return records.find((record) => record.keyHash === keyHash) ?? null; }
  async markUsed() {}
}

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp(rateLimiter: RateLimiter) {
  const app = await buildApp({ apiKeyRepository: new MemoryApiKeys(), logger: false, rateLimiter });
  apps.push(app);
  return app;
}

describe("rate limiting (HTTP)", () => {
  it("allows requests up to the per-key limit and returns a canonical 429 with Retry-After past it", async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, perKeyMax: 2, perCompanyMax: 100, perIpMax: 100 });
    const app = await makeApp(limiter);
    const headers = { authorization: `Bearer ${keyA}` };

    const first = await app.inject({ method: "GET", url: "/api/v1/me", headers });
    const second = await app.inject({ method: "GET", url: "/api/v1/me", headers });
    const third = await app.inject({ method: "GET", url: "/api/v1/me", headers });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
    expect(third.headers["retry-after"]).toMatch(/^\d+$/);
    expect(third.json()).toEqual({
      error: {
        code: "rate_limit_exceeded",
        message: expect.any(String),
        request_id: third.headers["x-request-id"]
      }
    });
  });

  it("does not let a second API key bypass an exhausted per-key bucket for the first", async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, perKeyMax: 1, perCompanyMax: 100, perIpMax: 100 });
    const app = await makeApp(limiter);

    const first = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${keyA}` } });
    const blocked = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${keyA}` } });
    const otherKey = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${keyB}` } });

    expect(first.statusCode).toBe(200);
    expect(blocked.statusCode).toBe(429);
    expect(otherKey.statusCode).toBe(200); // a different key has its own bucket
  });

  it("enforces a per-company bucket across multiple keys of the same company", async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, perKeyMax: 100, perCompanyMax: 2, perIpMax: 100 });
    const app = await makeApp(limiter);

    const first = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${keyA}` } });
    const second = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${keyB}` } });
    const third = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${keyA}` } });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200); // keyA and keyB share company 1's bucket
    expect(third.statusCode).toBe(429);
  });

  it("keeps company buckets independent from each other", async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, perKeyMax: 100, perCompanyMax: 1, perIpMax: 100 });
    const app = await makeApp(limiter);

    const company1 = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${keyA}` } });
    const company1Blocked = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${keyA}` } });
    const company2 = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${keyC}` } });

    expect(company1.statusCode).toBe(200);
    expect(company1Blocked.statusCode).toBe(429);
    expect(company2.statusCode).toBe(200);
  });

  it("enforces a per-IP bucket that also covers unauthenticated traffic", async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, perKeyMax: 100, perCompanyMax: 100, perIpMax: 2 });
    const app = await makeApp(limiter);
    const remoteAddress = "203.0.113.10";

    const unauthenticated1 = await app.inject({ method: "GET", url: "/api/v1/me", remoteAddress });
    const unauthenticated2 = await app.inject({ method: "GET", url: "/api/v1/me", remoteAddress });
    const thirdEvenWithAValidKey = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      remoteAddress,
      headers: { authorization: `Bearer ${keyA}` }
    });

    expect(unauthenticated1.statusCode).toBe(401); // no key: still consumes the IP bucket
    expect(unauthenticated2.statusCode).toBe(401);
    expect(thirdEvenWithAValidKey.statusCode).toBe(429); // blocked before auth even runs
  });

  it("keeps IP buckets independent from each other", async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, perKeyMax: 100, perCompanyMax: 100, perIpMax: 1 });
    const app = await makeApp(limiter);

    const first = await app.inject({ method: "GET", url: "/api/v1/me", remoteAddress: "203.0.113.1" });
    const second = await app.inject({ method: "GET", url: "/api/v1/me", remoteAddress: "203.0.113.2" });

    expect(first.statusCode).toBe(401); // unauthenticated, but not rate limited
    expect(second.statusCode).toBe(401);
  });

  it("never rate limits /health or /ready", async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, perKeyMax: 1, perCompanyMax: 1, perIpMax: 1 });
    const app = await makeApp(limiter);

    for (let i = 0; i < 5; i += 1) {
      const health = await app.inject({ method: "GET", url: "/health" });
      const ready = await app.inject({ method: "GET", url: "/ready" });
      expect(health.statusCode).toBe(200);
      expect(ready.statusCode).toBe(200);
    }
  });

  it("resets the per-key bucket once the configured window elapses", async () => {
    let now = 0;
    const limiter = new RateLimiter({ windowMs: 1_000, perKeyMax: 1, perCompanyMax: 100, perIpMax: 100 }, () => now);
    const app = await makeApp(limiter);
    const headers = { authorization: `Bearer ${keyA}` };

    const first = await app.inject({ method: "GET", url: "/api/v1/me", headers });
    const blocked = await app.inject({ method: "GET", url: "/api/v1/me", headers });
    now = 1_001;
    const afterReset = await app.inject({ method: "GET", url: "/api/v1/me", headers });

    expect(first.statusCode).toBe(200);
    expect(blocked.statusCode).toBe(429);
    expect(afterReset.statusCode).toBe(200);
  });
});
