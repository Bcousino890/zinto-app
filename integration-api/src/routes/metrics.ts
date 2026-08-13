import type { FastifyInstance } from "fastify";

import type { MetricsQueries, MetricsRegistry } from "../http/metrics.js";
import { renderPrometheusText } from "../http/metrics.js";

/**
 * Serves this service's own operational metrics in Prometheus text
 * exposition format. Same `internal/` prefix and reasoning as
 * `GET /internal/media/:id` (src/routes/media.ts): reached only over the
 * internal network, never through a partner API key, and only registered at
 * all when the caller (src/app.ts) is given a MetricsRegistry + MetricsQueries
 * pair - which src/server.ts only constructs when METRICS_ENABLED is true
 * (src/config.ts). See docs/api/METRICS-2026-08-13.md for the full reasoning
 * on why this ships off by default.
 */
export function registerMetricsRoute(
  app: FastifyInstance,
  registry: MetricsRegistry,
  queries: MetricsQueries
): void {
  app.get("/internal/metrics", async (request, reply) => {
    const outboxWebhookMetrics = await queries.collect();
    return reply
      .header("content-type", "text/plain; version=0.0.4; charset=utf-8")
      .send(renderPrometheusText(registry, outboxWebhookMetrics));
  });
}
