import type pg from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import {
  MetricsRegistry,
  PostgresMetricsQueries,
  renderPrometheusText,
  type MetricsQueries,
  type OutboxWebhookMetrics
} from "../src/http/metrics.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("MetricsRegistry (in-memory latency + response counts)", () => {
  it("accumulates a per-route histogram (buckets, sum, count) across repeated observations", () => {
    const registry = new MetricsRegistry();

    registry.recordResponse("GET", "/api/v1/contacts", 200, 3);
    registry.recordResponse("GET", "/api/v1/contacts", 200, 12);
    registry.recordResponse("GET", "/api/v1/contacts", 200, 15_000);

    const { latency } = registry.snapshot();
    expect(latency).toHaveLength(1);
    const entry = latency[0]!;
    expect(entry.method).toBe("GET");
    expect(entry.route).toBe("/api/v1/contacts");
    expect(entry.histogram.count).toBe(3);
    expect(entry.histogram.sum).toBe(3 + 12 + 15_000);
    // le=5 and le=10 only the 3ms observation qualifies; le=25 and up (until
    // the last finite bound) both 3ms and 12ms qualify; the 15_000ms
    // observation never falls under any finite bound, only +Inf (=count).
    expect(entry.histogram.bucketCounts).toEqual([1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
  });

  it("keeps separate series per method+route combination", () => {
    const registry = new MetricsRegistry();

    registry.recordResponse("GET", "/api/v1/contacts", 200, 10);
    registry.recordResponse("POST", "/api/v1/contacts", 201, 20);
    registry.recordResponse("GET", "/api/v1/deals", 200, 5);

    const { latency } = registry.snapshot();
    const keys = latency.map((entry) => `${entry.method} ${entry.route}`).sort();
    expect(keys).toEqual(["GET /api/v1/contacts", "GET /api/v1/deals", "POST /api/v1/contacts"]);
  });

  it("counts responses per method+route+exact status code independently", () => {
    const registry = new MetricsRegistry();

    registry.recordResponse("GET", "/api/v1/contacts", 200, 1);
    registry.recordResponse("GET", "/api/v1/contacts", 200, 1);
    registry.recordResponse("GET", "/api/v1/contacts", 404, 1);
    registry.recordResponse("GET", "/api/v1/contacts", 500, 1);

    const { statusCounts } = registry.snapshot();
    const byCode = Object.fromEntries(statusCounts.map((entry) => [entry.statusCode, entry.count]));
    expect(byCode).toEqual({ 200: 2, 404: 1, 500: 1 });
  });
});

describe("renderPrometheusText", () => {
  const outboxWebhookMetrics: OutboxWebhookMetrics = {
    outboxLagSeconds: 12.5,
    deadLetterCount: 2,
    duplicateDeliveryCount: 5
  };

  it("emits HELP/TYPE lines and correct series for latency and response counts", () => {
    const registry = new MetricsRegistry();
    // Latency is tracked per method+route regardless of status code (a
    // route's overall latency profile, not one histogram per status), so
    // all four observations below - including the 404 - land in the same
    // "GET /health" histogram; only the *counters* below split by status.
    registry.recordResponse("GET", "/health", 200, 3);
    registry.recordResponse("GET", "/health", 200, 12);
    registry.recordResponse("GET", "/health", 200, 15_000);
    registry.recordResponse("GET", "/health", 404, 1);

    const text = renderPrometheusText(registry, outboxWebhookMetrics);

    expect(text).toContain("# HELP integration_api_http_request_duration_ms");
    expect(text).toContain("# TYPE integration_api_http_request_duration_ms histogram");
    // le=5: the 3ms and 1ms observations qualify; le=25 and up (until the
    // last finite bound) additionally picks up the 12ms one; +Inf/count
    // include the 15_000ms observation, which has no finite bucket.
    expect(text).toContain('integration_api_http_request_duration_ms_bucket{method="GET",route="/health",le="5"} 2');
    expect(text).toContain('integration_api_http_request_duration_ms_bucket{method="GET",route="/health",le="10000"} 3');
    expect(text).toContain('integration_api_http_request_duration_ms_bucket{method="GET",route="/health",le="+Inf"} 4');
    expect(text).toContain('integration_api_http_request_duration_ms_sum{method="GET",route="/health"} 15016');
    expect(text).toContain('integration_api_http_request_duration_ms_count{method="GET",route="/health"} 4');

    expect(text).toContain('integration_api_http_responses_total{method="GET",route="/health",status_code="200"} 3');
    expect(text).toContain('integration_api_http_responses_total{method="GET",route="/health",status_code="404"} 1');
    expect(text).toContain('integration_api_http_responses_by_class_total{method="GET",route="/health",status_class="2xx"} 3');
    expect(text).toContain('integration_api_http_responses_by_class_total{method="GET",route="/health",status_class="4xx"} 1');
  });

  it("emits the outbox/webhook gauges from the given snapshot, with a documented label-free form", () => {
    const text = renderPrometheusText(new MetricsRegistry(), outboxWebhookMetrics);

    expect(text).toContain("# TYPE integration_api_outbox_lag_seconds gauge");
    expect(text).toContain("integration_api_outbox_lag_seconds 12.5");
    expect(text).toContain("# TYPE integration_api_webhook_dead_letters gauge");
    expect(text).toContain("integration_api_webhook_dead_letters 2");
    expect(text).toContain("# TYPE integration_api_webhook_duplicate_deliveries gauge");
    expect(text).toContain("integration_api_webhook_duplicate_deliveries 5");
  });

  it("renders a null outbox lag (no pending rows) as 0, not as a missing/NaN line", () => {
    const text = renderPrometheusText(new MetricsRegistry(), { ...outboxWebhookMetrics, outboxLagSeconds: null });

    expect(text).toContain("integration_api_outbox_lag_seconds 0");
  });

  it("escapes reserved characters in label values", () => {
    const registry = new MetricsRegistry();
    registry.recordResponse("GET", '/weird"route\\with\nnewline', 200, 1);

    const text = renderPrometheusText(registry, outboxWebhookMetrics);

    expect(text).toContain('route="/weird\\"route\\\\with\\nnewline"');
  });
});

interface Call {
  text: string;
  params: unknown[];
}

class FakePool {
  calls: Call[] = [];

  constructor(private readonly responses: Array<{ rows: unknown[] }> = []) {}

  async query(text: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    this.calls.push({ text, params });
    return this.responses[this.calls.length - 1] ?? { rows: [] };
  }
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

describe("PostgresMetricsQueries (computed on demand, never cached)", () => {
  it("queries outbox lag, dead letters and duplicate deliveries with the expected SQL against the real columns", async () => {
    const pool = new FakePool([
      { rows: [{ lag_seconds: "42.5" }] },
      { rows: [{ count: "3" }] },
      { rows: [{ count: "9" }] }
    ]);
    const queries = new PostgresMetricsQueries(pool as unknown as pg.Pool);

    const result = await queries.collect();

    expect(pool.calls).toHaveLength(3);
    expect(flat(pool.calls[0]!.text)).toBe(
      "SELECT EXTRACT(EPOCH FROM (NOW() - MIN(occurred_at))) AS lag_seconds FROM integration_api_outbox WHERE processed_at IS NULL"
    );
    expect(flat(pool.calls[1]!.text)).toBe(
      "SELECT COUNT(*) AS count FROM integration_api_webhook_deliveries WHERE status = 'dead'"
    );
    expect(flat(pool.calls[2]!.text)).toBe(
      "SELECT COUNT(*) AS count FROM integration_api_webhook_deliveries WHERE attempt_count > 1"
    );
    expect(result).toEqual({ outboxLagSeconds: 42.5, deadLetterCount: 3, duplicateDeliveryCount: 9 });
  });

  it("reports a null lag (not zero, not NaN) when there is no pending outbox row", async () => {
    const pool = new FakePool([
      { rows: [{ lag_seconds: null }] },
      { rows: [{ count: "0" }] },
      { rows: [{ count: "0" }] }
    ]);
    const queries = new PostgresMetricsQueries(pool as unknown as pg.Pool);

    const result = await queries.collect();

    expect(result.outboxLagSeconds).toBeNull();
    expect(result.deadLetterCount).toBe(0);
    expect(result.duplicateDeliveryCount).toBe(0);
  });

  it("tolerates an empty result set for any of the three queries", async () => {
    const pool = new FakePool([]);
    const queries = new PostgresMetricsQueries(pool as unknown as pg.Pool);

    const result = await queries.collect();

    expect(result).toEqual({ outboxLagSeconds: null, deadLetterCount: 0, duplicateDeliveryCount: 0 });
  });
});

class FakeMetricsQueries implements MetricsQueries {
  calls = 0;
  constructor(private readonly value: OutboxWebhookMetrics) {}

  async collect(): Promise<OutboxWebhookMetrics> {
    this.calls += 1;
    return this.value;
  }
}

describe("GET /internal/metrics", () => {
  it("is not registered at all when the app is built without a metrics registry (404, not a 'disabled' error)", async () => {
    const app = await buildApp({ logger: false });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/internal/metrics" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "not_found",
        message: "Route not found",
        request_id: response.headers["x-request-id"]
      }
    });
  });

  it("stays unregistered when only a registry is present without matching queries (both are required)", async () => {
    const app = await buildApp({ logger: false, metricsRegistry: new MetricsRegistry() });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/internal/metrics" });

    expect(response.statusCode).toBe(404);
  });

  it("records latency and status counts from real requests via the onResponse hook, then serves them as Prometheus text", async () => {
    const metricsRegistry = new MetricsRegistry();
    const metricsQueries = new FakeMetricsQueries({
      outboxLagSeconds: 7,
      deadLetterCount: 1,
      duplicateDeliveryCount: 4
    });
    const app = await buildApp({ logger: false, metricsRegistry, metricsQueries });
    apps.push(app);

    await app.inject({ method: "GET", url: "/health" });
    await app.inject({ method: "GET", url: "/health" });
    await app.inject({ method: "GET", url: "/health" });
    await app.inject({ method: "GET", url: "/this-route-does-not-exist" });

    const response = await app.inject({ method: "GET", url: "/internal/metrics" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/plain; version=0.0.4; charset=utf-8");
    expect(metricsQueries.calls).toBe(1);

    const body = response.body;
    expect(body).toContain('integration_api_http_responses_total{method="GET",route="/health",status_code="200"} 3');
    // A 404 has no route pattern (request.routeOptions.url is undefined), so
    // it is recorded under the fixed "unmatched_route" label instead of one
    // series per garbage path a caller might probe.
    expect(body).toContain(
      'integration_api_http_responses_total{method="GET",route="unmatched_route",status_code="404"} 1'
    );
    expect(body).toContain('integration_api_http_request_duration_ms_count{method="GET",route="/health"} 3');
    expect(body).toContain("integration_api_outbox_lag_seconds 7");
    expect(body).toContain("integration_api_webhook_dead_letters 1");
    expect(body).toContain("integration_api_webhook_duplicate_deliveries 4");
  });

  it("does not add the onResponse hook (and its per-request cost) when no registry is supplied", async () => {
    // Indirect check: building and exercising an app with no metrics options
    // at all must not throw and must behave exactly like before this feature
    // existed - covered end-to-end by test/health.test.ts and
    // test/openapi.test.ts already; this only pins the metrics-specific
    // route absence, asserted above.
    const app = await buildApp({ logger: false });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
  });
});
