import { z } from "zod";

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  HOST: z.string().min(1).default("0.0.0.0"),
  LEGACY_API_URL: z.string().url(),
  LEGACY_DELIVERY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  MEDIA_PROXY_ENABLED: z.enum(["true", "false"]).default("false")
    .transform((value) => value === "true"),
  MEDIA_STORAGE_DIR: z.string().min(1).default("/var/lib/zinto-media"),
  MEDIA_INTERNAL_BASE_URL: z.string().url().optional(),
  MEDIA_MAX_BYTES: z.coerce.number().int().min(1024).max(104_857_600).default(16_777_216),
  MEDIA_RETENTION_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
  READ_ONLY_MODE: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  WEBHOOK_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/),
  WEBHOOK_WORKER_ENABLED: z.enum(["true", "false"]).default("false")
    .transform((value) => value === "true")
}).superRefine((value, context) => {
  // Serving proxied media without knowing the address the engine should call
  // would silently fall back to handing it the partner URL again.
  if (value.MEDIA_PROXY_ENABLED && value.MEDIA_INTERNAL_BASE_URL === undefined) {
    context.addIssue({
      code: "custom",
      path: ["MEDIA_INTERNAL_BASE_URL"],
      message: "MEDIA_INTERNAL_BASE_URL is required when MEDIA_PROXY_ENABLED is true"
    });
  }
});

export type ServiceConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServiceConfig {
  return configSchema.parse(environment);
}
