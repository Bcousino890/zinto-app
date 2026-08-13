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
});
