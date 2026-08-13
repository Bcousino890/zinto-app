import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { defaultRateLimitConfig } from "../src/http/rate-limit.js";

const required = {
  DATABASE_URL: "postgres://zinto:test@db:5432/zinto",
  LEGACY_API_URL: "http://legacy:9000",
  WEBHOOK_ENCRYPTION_KEY: "a".repeat(64)
};

describe("safe deployment configuration", () => {
  it("defaults to read-only with the webhook worker disabled", () => {
    const config = loadConfig(required);

    expect(config.READ_ONLY_MODE).toBe(true);
    expect(config.WEBHOOK_WORKER_ENABLED).toBe(false);
  });

  it("requires explicit boolean flags to enable writes and webhook delivery", () => {
    const config = loadConfig({
      ...required,
      READ_ONLY_MODE: "false",
      WEBHOOK_WORKER_ENABLED: "true"
    });

    expect(config.READ_ONLY_MODE).toBe(false);
    expect(config.WEBHOOK_WORKER_ENABLED).toBe(true);
  });

  it("defaults the write allowlists to empty sets", () => {
    const config = loadConfig(required);

    expect(config.WRITE_ENABLED_API_KEY_IDS).toEqual([]);
    expect(config.WRITE_ENABLED_COMPANY_IDS).toEqual([]);
  });

  it("parses the write allowlists as distinct positive integers", () => {
    const config = loadConfig({
      ...required,
      WRITE_ENABLED_API_KEY_IDS: "7,11,7",
      WRITE_ENABLED_COMPANY_IDS: "3,12,3"
    });

    expect(config.WRITE_ENABLED_API_KEY_IDS).toEqual([7, 11]);
    expect(config.WRITE_ENABLED_COMPANY_IDS).toEqual([3, 12]);
  });

  it("rejects invalid write allowlist values", () => {
    expect(() => loadConfig({ ...required, WRITE_ENABLED_API_KEY_IDS: "0,7" })).toThrow();
    expect(() => loadConfig({ ...required, WRITE_ENABLED_COMPANY_IDS: "3,nope" })).toThrow();
    expect(() => loadConfig({ ...required, WRITE_ENABLED_API_KEY_IDS: "9007199254740992" })).toThrow();
  });

  it("keeps the media proxy disabled unless it is switched on explicitly", () => {
    expect(loadConfig(required).MEDIA_PROXY_ENABLED).toBe(false);
  });

  it("keeps internal metrics disabled unless switched on explicitly, with no companion variable required", () => {
    expect(loadConfig(required).METRICS_ENABLED).toBe(false);
    expect(loadConfig({ ...required, METRICS_ENABLED: "true" }).METRICS_ENABLED).toBe(true);
  });

  it("defaults the legacy delivery timeout to a bounded, reasonable value", () => {
    const config = loadConfig(required);

    expect(config.LEGACY_DELIVERY_TIMEOUT_MS).toBe(30_000);
    expect(() => loadConfig({ ...required, LEGACY_DELIVERY_TIMEOUT_MS: "500" })).toThrow();
    expect(() => loadConfig({ ...required, LEGACY_DELIVERY_TIMEOUT_MS: "999999" })).toThrow();
  });

  it("refuses to enable the media proxy without the address the engine must call", () => {
    expect(() => loadConfig({ ...required, MEDIA_PROXY_ENABLED: "true" })).toThrow();
    expect(loadConfig({
      ...required,
      MEDIA_PROXY_ENABLED: "true",
      MEDIA_INTERNAL_BASE_URL: "http://zinto-integration-api:3100"
    }).MEDIA_PROXY_ENABLED).toBe(true);
  });

  it("defaults each media type's byte limit to the real WhatsApp Business API cap for that type", () => {
    const config = loadConfig(required);

    // Image 5 MB, video 16 MB, audio 16 MB, document 100 MB - see
    // docs/api/MEDIA-PROXY-2026-08-13.md for why these differ per type
    // instead of sharing one limit.
    expect(config.MEDIA_MAX_BYTES_IMAGE).toBe(5_242_880);
    expect(config.MEDIA_MAX_BYTES_VIDEO).toBe(16_777_216);
    expect(config.MEDIA_MAX_BYTES_AUDIO).toBe(16_777_216);
    expect(config.MEDIA_MAX_BYTES_DOCUMENT).toBe(104_857_600);
  });

  it("allows each media type's byte limit to be tuned independently per deployment", () => {
    const config = loadConfig({
      ...required,
      MEDIA_MAX_BYTES_IMAGE: "2097152",
      MEDIA_MAX_BYTES_VIDEO: "8388608",
      MEDIA_MAX_BYTES_AUDIO: "4194304",
      MEDIA_MAX_BYTES_DOCUMENT: "52428800"
    });

    expect(config.MEDIA_MAX_BYTES_IMAGE).toBe(2_097_152);
    expect(config.MEDIA_MAX_BYTES_VIDEO).toBe(8_388_608);
    expect(config.MEDIA_MAX_BYTES_AUDIO).toBe(4_194_304);
    expect(config.MEDIA_MAX_BYTES_DOCUMENT).toBe(52_428_800);
  });

  it("keeps each media byte limit within the same sane bounds the old shared MEDIA_MAX_BYTES enforced", () => {
    const variables = ["MEDIA_MAX_BYTES_IMAGE", "MEDIA_MAX_BYTES_VIDEO", "MEDIA_MAX_BYTES_AUDIO", "MEDIA_MAX_BYTES_DOCUMENT"] as const;

    for (const name of variables) {
      expect(() => loadConfig({ ...required, [name]: "1023" })).toThrow();
      expect(loadConfig({ ...required, [name]: "1024" })[name]).toBe(1024);
      expect(loadConfig({ ...required, [name]: "104857600" })[name]).toBe(104_857_600);
      expect(() => loadConfig({ ...required, [name]: "104857601" })).toThrow();
    }
  });

  it("defaults rate limiting to the documented, conservative values", () => {
    const config = loadConfig(required);

    expect(config.RATE_LIMIT_WINDOW_MS).toBe(defaultRateLimitConfig.windowMs);
    expect(config.RATE_LIMIT_PER_KEY_MAX).toBe(defaultRateLimitConfig.perKeyMax);
    expect(config.RATE_LIMIT_PER_COMPANY_MAX).toBe(defaultRateLimitConfig.perCompanyMax);
    expect(config.RATE_LIMIT_PER_IP_MAX).toBe(defaultRateLimitConfig.perIpMax);
  });

  it("allows the rate limit thresholds to be tuned per deployment", () => {
    const config = loadConfig({
      ...required,
      RATE_LIMIT_WINDOW_MS: "30000",
      RATE_LIMIT_PER_KEY_MAX: "50",
      RATE_LIMIT_PER_COMPANY_MAX: "150",
      RATE_LIMIT_PER_IP_MAX: "80"
    });

    expect(config.RATE_LIMIT_WINDOW_MS).toBe(30_000);
    expect(config.RATE_LIMIT_PER_KEY_MAX).toBe(50);
    expect(config.RATE_LIMIT_PER_COMPANY_MAX).toBe(150);
    expect(config.RATE_LIMIT_PER_IP_MAX).toBe(80);
  });

  it("defaults the bookkeeping-table retention windows to a grace period longer than the outbox window", () => {
    const config = loadConfig(required);

    expect(config.IDEMPOTENCY_RETENTION_HOURS).toBe(24);
    expect(config.OUTBOX_RETENTION_DAYS).toBe(7);
    expect(config.WEBHOOK_DELIVERY_RETENTION_DAYS).toBe(30);
    // Delivery history is meant to outlive the raw outbox events that produced it.
    expect(config.WEBHOOK_DELIVERY_RETENTION_DAYS).toBeGreaterThan(config.OUTBOX_RETENTION_DAYS);
  });

  it("allows the retention windows to be tuned per deployment within sane bounds", () => {
    const config = loadConfig({
      ...required,
      IDEMPOTENCY_RETENTION_HOURS: "48",
      OUTBOX_RETENTION_DAYS: "14",
      WEBHOOK_DELIVERY_RETENTION_DAYS: "60"
    });

    expect(config.IDEMPOTENCY_RETENTION_HOURS).toBe(48);
    expect(config.OUTBOX_RETENTION_DAYS).toBe(14);
    expect(config.WEBHOOK_DELIVERY_RETENTION_DAYS).toBe(60);

    expect(() => loadConfig({ ...required, IDEMPOTENCY_RETENTION_HOURS: "0" })).toThrow();
    expect(() => loadConfig({ ...required, IDEMPOTENCY_RETENTION_HOURS: "169" })).toThrow();
    expect(() => loadConfig({ ...required, OUTBOX_RETENTION_DAYS: "0" })).toThrow();
    expect(() => loadConfig({ ...required, OUTBOX_RETENTION_DAYS: "91" })).toThrow();
    expect(() => loadConfig({ ...required, WEBHOOK_DELIVERY_RETENTION_DAYS: "0" })).toThrow();
    expect(() => loadConfig({ ...required, WEBHOOK_DELIVERY_RETENTION_DAYS: "181" })).toThrow();
  });
});
