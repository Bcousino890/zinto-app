import { z } from "zod";

import { defaultRateLimitConfig } from "./http/rate-limit.js";

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  HOST: z.string().min(1).default("0.0.0.0"),
  LEGACY_API_URL: z.string().url(),
  LEGACY_DELIVERY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // See src/http/rate-limit.ts for why these three buckets are sized the way
  // they are (key < IP < company).
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000)
    .default(defaultRateLimitConfig.windowMs),
  RATE_LIMIT_PER_KEY_MAX: z.coerce.number().int().min(1).default(defaultRateLimitConfig.perKeyMax),
  RATE_LIMIT_PER_COMPANY_MAX: z.coerce.number().int().min(1).default(defaultRateLimitConfig.perCompanyMax),
  RATE_LIMIT_PER_IP_MAX: z.coerce.number().int().min(1).default(defaultRateLimitConfig.perIpMax),
  READ_ONLY_MODE: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  WEBHOOK_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/),
  WEBHOOK_WORKER_ENABLED: z.enum(["true", "false"]).default("false")
    .transform((value) => value === "true")
});

export type ServiceConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServiceConfig {
  return configSchema.parse(environment);
}
