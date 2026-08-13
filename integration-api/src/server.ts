import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

async function start(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({
    logger: {
      level: config.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie"]
    }
  });

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

void start();
