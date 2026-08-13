import { z } from "zod";

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  HOST: z.string().min(1).default("0.0.0.0"),
  LEGACY_API_URL: z.string().url(),
  LEGACY_DELIVERY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false").transform((value) => value === "true")
});

export type ServiceConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServiceConfig {
  return configSchema.parse(environment);
}
