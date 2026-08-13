import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

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
});
