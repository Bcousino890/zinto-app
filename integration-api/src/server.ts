import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PostgresApiKeyRepository } from "./db/api-keys.js";
import { createDatabasePool } from "./db/pool.js";
import { PostgresCoreRepository } from "./resources/core.js";

async function start(): Promise<void> {
  const config = loadConfig();
  const pool = createDatabasePool(config.DATABASE_URL);
  const app = await buildApp({
    apiKeyRepository: new PostgresApiKeyRepository(pool),
    coreRepository: new PostgresCoreRepository(pool),
    logger: {
      level: config.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie"]
    },
    onClose: async () => pool.end(),
    trustProxy: config.TRUST_PROXY
  });

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

void start();
