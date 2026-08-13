import { z } from "zod";

import { defaultRateLimitConfig } from "./http/rate-limit.js";

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
  // Serves GET /internal/metrics (Prometheus text format: request latency and
  // response counts per route from an in-memory registry, plus outbox lag /
  // dead letters / duplicate deliveries queried from Postgres on demand - see
  // src/http/metrics.ts). Off by default for the same reason MEDIA_PROXY_ENABLED
  // is: the /internal/ prefix is only meant to be reachable from inside the
  // Docker network, and as of this writing the reverse proxy rule that should
  // deny it publicly (deploy/nginx-integration-api-preview.conf) has not been
  // confirmed applied to the real production vhost - see
  // docs/api/METRICS-2026-08-13.md. Unlike MEDIA_PROXY_ENABLED this flag has no
  // required companion variable: it only needs the pool this service already
  // requires via DATABASE_URL, so there is nothing extra to fail closed on -
  // the safe default is simply that the route does not exist until this is
  // turned on.
  METRICS_ENABLED: z.enum(["true", "false"]).default("false")
    .transform((value) => value === "true"),
  // Retention for the service's own bookkeeping tables (idempotency records,
  // the event outbox, and webhook delivery attempts) - see src/db/retention.ts
  // for the purge job and the reasoning behind each window.
  //
  // IDEMPOTENCY_RETENTION_HOURS is a grace period *added on top of* the
  // expires_at each row already gets at insert time (24h, see
  // migrations/001_integration_api.sql) - the read path already ignores rows
  // past expires_at, so this only controls how long an expired row lingers
  // for debugging/support ("the partner says we double-charged them") before
  // it is deleted. 24h of extra grace (48h total from creation) is generous
  // enough to absorb clock skew and a late partner retry without keeping
  // rows around indefinitely.
  IDEMPOTENCY_RETENTION_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  // OUTBOX_RETENTION_DAYS keeps processed outbox events around for a week so
  // recent delivery activity can still be debugged, without letting the
  // table grow forever.
  OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  // WEBHOOK_DELIVERY_RETENTION_DAYS outlives the outbox window on purpose:
  // delivery rows are the audit trail partners and support ask about
  // ("why didn't my webhook fire on the 3rd?") and they are cheap to keep
  // (no event payload, just status/attempt metadata), so they get a longer
  // default retention than the raw outbox events they were generated from.
  WEBHOOK_DELIVERY_RETENTION_DAYS: z.coerce.number().int().min(1).max(180).default(30),
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
