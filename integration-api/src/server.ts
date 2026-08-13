import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PostgresApiKeyRepository } from "./db/api-keys.js";
import { PostgresIdempotencyRepository } from "./db/idempotency.js";
import { LegacyDeliveryClient } from "./delivery/client.js";
import { createDatabasePool } from "./db/pool.js";
import { PostgresRetentionRepository, startRetentionPurge } from "./db/retention.js";
import { secureLoggerOptions } from "./http/logging.js";
import { RateLimiter } from "./http/rate-limit.js";
import { DownloadingMediaProxy } from "./media/proxy.js";
import { FilesystemMediaStore } from "./media/store.js";
import { MetricsRegistry, PostgresMetricsQueries } from "./http/metrics.js";
import { PostgresCoreRepository } from "./resources/core.js";
import { PostgresContactMutationRepository } from "./resources/contact-mutations.js";
import { PostgresConversationMutationRepository } from "./resources/conversation-mutations.js";
import { PostgresDeliveryAuditRepository } from "./resources/delivery-audit.js";
import { PostgresPipelineMutationRepository } from "./resources/pipeline-mutations.js";
import { PostgresPipelineCrudRepository } from "./resources/pipeline-crud.js";
import { PostgresPipelineRepository } from "./resources/pipelines.js";
import { PostgresTaskMutationRepository } from "./resources/task-mutations.js";
import { WebhookSecretCipher } from "./webhooks/cipher.js";
import { PostgresWebhookDeliveryRepository } from "./webhooks/deliveries.js";
import { PostgresWebhookRepository } from "./webhooks/repository.js";
import { startWebhookWorker } from "./webhooks/worker.js";

async function start(): Promise<void> {
  const config = loadConfig();
  const pool = createDatabasePool(config.DATABASE_URL);
  const webhookCipher = new WebhookSecretCipher(config.WEBHOOK_ENCRYPTION_KEY);
  let stopWebhookWorker: () => void = () => undefined;
  let stopRetentionPurge: () => void = () => undefined;
  const mediaStore = config.MEDIA_PROXY_ENABLED
    ? new FilesystemMediaStore(config.MEDIA_STORAGE_DIR, config.MEDIA_INTERNAL_BASE_URL!)
    : undefined;
  const mediaPurge = mediaStore === undefined ? undefined : setInterval(() => {
    void mediaStore.purge(new Date(Date.now() - config.MEDIA_RETENTION_MINUTES * 60_000));
  }, 60_000);
  mediaPurge?.unref();
  // Both undefined unless METRICS_ENABLED is true, which is what keeps
  // GET /internal/metrics from being registered at all (src/app.ts) - see
  // docs/api/METRICS-2026-08-13.md for why this ships off by default.
  const metricsRegistry = config.METRICS_ENABLED ? new MetricsRegistry() : undefined;
  const metricsQueries = config.METRICS_ENABLED ? new PostgresMetricsQueries(pool) : undefined;
  const app = await buildApp({
    apiKeyRepository: new PostgresApiKeyRepository(pool),
    contactMutationRepository: new PostgresContactMutationRepository(pool),
    conversationMutationRepository: new PostgresConversationMutationRepository(pool),
    coreRepository: new PostgresCoreRepository(pool),
    deliveryAuditRepository: new PostgresDeliveryAuditRepository(pool),
    deliveryClient: new LegacyDeliveryClient(config.LEGACY_API_URL, config.LEGACY_DELIVERY_TIMEOUT_MS),
    idempotencyRepository: new PostgresIdempotencyRepository(pool),
    logger: secureLoggerOptions(config.LOG_LEVEL),
    mediaProxy: mediaStore === undefined ? undefined : new DownloadingMediaProxy(mediaStore, {
      timeoutMs: config.LEGACY_DELIVERY_TIMEOUT_MS
    }, {
      image: config.MEDIA_MAX_BYTES_IMAGE,
      video: config.MEDIA_MAX_BYTES_VIDEO,
      audio: config.MEDIA_MAX_BYTES_AUDIO,
      document: config.MEDIA_MAX_BYTES_DOCUMENT
    }),
    mediaStore,
    metricsQueries,
    metricsRegistry,
    pipelineMutationRepository: new PostgresPipelineMutationRepository(pool),
    pipelineCrudRepository: new PostgresPipelineCrudRepository(pool),
    pipelineRepository: new PostgresPipelineRepository(pool),
    taskMutationRepository: new PostgresTaskMutationRepository(pool),
    onClose: async () => {
      stopWebhookWorker();
      stopRetentionPurge();
      if (mediaPurge !== undefined) clearInterval(mediaPurge);
      await pool.end();
    },
    rateLimiter: new RateLimiter({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      perKeyMax: config.RATE_LIMIT_PER_KEY_MAX,
      perCompanyMax: config.RATE_LIMIT_PER_COMPANY_MAX,
      perIpMax: config.RATE_LIMIT_PER_IP_MAX
    }),
    readOnly: config.READ_ONLY_MODE,
    writeEnabledApiKeyIds: new Set(config.WRITE_ENABLED_API_KEY_IDS),
    writeEnabledCompanyIds: new Set(config.WRITE_ENABLED_COMPANY_IDS),
    readinessCheck: async () => {
      await pool.query("SELECT 1");
    },
    trustProxy: config.TRUST_PROXY,
    webhookRepository: new PostgresWebhookRepository(pool, webhookCipher)
  });
  if (config.WEBHOOK_WORKER_ENABLED) {
    stopWebhookWorker = startWebhookWorker(
      new PostgresWebhookDeliveryRepository(pool, webhookCipher),
      1000,
      (error) => app.log.error({ err: error }, "webhook worker iteration failed")
    );
  }
  // Runs unconditionally, like mediaPurge above: it only ever deletes rows
  // from this service's own idempotency/outbox/webhook-delivery tables (never
  // business data), so there is no read-only or feature-flag gate to honor -
  // READ_ONLY_MODE only guards the partner-facing /api/v1/ write routes
  // (see src/app.ts).
  stopRetentionPurge = startRetentionPurge(
    new PostgresRetentionRepository(pool),
    {
      idempotencyGraceMs: config.IDEMPOTENCY_RETENTION_HOURS * 60 * 60_000,
      outboxRetentionMs: config.OUTBOX_RETENTION_DAYS * 24 * 60 * 60_000,
      webhookDeliveryRetentionMs: config.WEBHOOK_DELIVERY_RETENTION_DAYS * 24 * 60 * 60_000
    },
    60_000,
    (scope, error) => app.log.error({ err: error, scope }, "retention purge failed")
  );

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

void start();
