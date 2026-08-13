import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PostgresApiKeyRepository } from "./db/api-keys.js";
import { PostgresIdempotencyRepository } from "./db/idempotency.js";
import { LegacyDeliveryClient } from "./delivery/client.js";
import { createDatabasePool } from "./db/pool.js";
import { secureLoggerOptions } from "./http/logging.js";
import { RateLimiter } from "./http/rate-limit.js";
import { DownloadingMediaProxy } from "./media/proxy.js";
import { FilesystemMediaStore } from "./media/store.js";
import { PostgresCoreRepository } from "./resources/core.js";
import { PostgresContactMutationRepository } from "./resources/contact-mutations.js";
import { PostgresPipelineRepository } from "./resources/pipelines.js";
import { WebhookSecretCipher } from "./webhooks/cipher.js";
import { PostgresWebhookDeliveryRepository } from "./webhooks/deliveries.js";
import { PostgresWebhookRepository } from "./webhooks/repository.js";
import { startWebhookWorker } from "./webhooks/worker.js";

async function start(): Promise<void> {
  const config = loadConfig();
  const pool = createDatabasePool(config.DATABASE_URL);
  const webhookCipher = new WebhookSecretCipher(config.WEBHOOK_ENCRYPTION_KEY);
  let stopWebhookWorker: () => void = () => undefined;
  const mediaStore = config.MEDIA_PROXY_ENABLED
    ? new FilesystemMediaStore(config.MEDIA_STORAGE_DIR, config.MEDIA_INTERNAL_BASE_URL!)
    : undefined;
  const mediaPurge = mediaStore === undefined ? undefined : setInterval(() => {
    void mediaStore.purge(new Date(Date.now() - config.MEDIA_RETENTION_MINUTES * 60_000));
  }, 60_000);
  mediaPurge?.unref();
  const app = await buildApp({
    apiKeyRepository: new PostgresApiKeyRepository(pool),
    contactMutationRepository: new PostgresContactMutationRepository(pool),
    coreRepository: new PostgresCoreRepository(pool),
    deliveryClient: new LegacyDeliveryClient(config.LEGACY_API_URL, config.LEGACY_DELIVERY_TIMEOUT_MS),
    idempotencyRepository: new PostgresIdempotencyRepository(pool),
    logger: secureLoggerOptions(config.LOG_LEVEL),
    mediaProxy: mediaStore === undefined ? undefined : new DownloadingMediaProxy(mediaStore, {
      maxBytes: config.MEDIA_MAX_BYTES,
      timeoutMs: config.LEGACY_DELIVERY_TIMEOUT_MS
    }),
    mediaStore,
    pipelineRepository: new PostgresPipelineRepository(pool),
    onClose: async () => {
      stopWebhookWorker();
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

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

void start();
