import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PostgresApiKeyRepository } from "./db/api-keys.js";
import { PostgresIdempotencyRepository } from "./db/idempotency.js";
import { LegacyDeliveryClient } from "./delivery/client.js";
import { createDatabasePool } from "./db/pool.js";
import { PostgresCoreRepository } from "./resources/core.js";
import { PostgresContactMutationRepository } from "./resources/contact-mutations.js";
import { WebhookSecretCipher } from "./webhooks/cipher.js";
import { PostgresWebhookDeliveryRepository } from "./webhooks/deliveries.js";
import { PostgresWebhookRepository } from "./webhooks/repository.js";
import { startWebhookWorker } from "./webhooks/worker.js";

async function start(): Promise<void> {
  const config = loadConfig();
  const pool = createDatabasePool(config.DATABASE_URL);
  const webhookCipher = new WebhookSecretCipher(config.WEBHOOK_ENCRYPTION_KEY);
  let stopWebhookWorker: () => void = () => undefined;
  const app = await buildApp({
    apiKeyRepository: new PostgresApiKeyRepository(pool),
    contactMutationRepository: new PostgresContactMutationRepository(pool),
    coreRepository: new PostgresCoreRepository(pool),
    deliveryClient: new LegacyDeliveryClient(config.LEGACY_API_URL, config.LEGACY_DELIVERY_TIMEOUT_MS),
    idempotencyRepository: new PostgresIdempotencyRepository(pool),
    logger: {
      level: config.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie"]
    },
    onClose: async () => {
      stopWebhookWorker();
      await pool.end();
    },
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
