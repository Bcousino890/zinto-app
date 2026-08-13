import type pg from "pg";

/**
 * Operational metrics for this service, exposed at `GET /internal/metrics`
 * (see src/routes/metrics.ts) in Prometheus text exposition format.
 *
 * Two kinds of data are combined here, deliberately kept apart:
 *
 * - Request latency and response counts are accumulated in memory as
 *   requests happen (see `MetricsRegistry.recordResponse`, fed by an
 *   `onResponse` hook in src/app.ts). They reset when the process restarts,
 *   which is fine: they describe recent traffic, not durable state.
 * - Outbox lag, dead letters and duplicate deliveries reflect the *current*
 *   state of the `integration_api_outbox` and
 *   `integration_api_webhook_deliveries` tables (see
 *   migrations/001_integration_api.sql). Accumulating those in memory would
 *   make them lie the moment two instances of this service run side by side,
 *   or the moment the process restarts, so `PostgresMetricsQueries` computes
 *   them fresh, with a single small query each, at scrape time instead.
 *
 * See docs/api/METRICS-2026-08-13.md for why this endpoint ships disabled by
 * default (`METRICS_ENABLED`, src/config.ts) and what is still missing before
 * it can be turned on in production.
 */

/**
 * Upper bounds (inclusive, milliseconds) of the fixed latency buckets, in the
 * same spirit as a Prometheus histogram. This is not meant to be a precise
 * statistical instrument - it is enough resolution to tell "fast", "a bit
 * slow" and "clearly hung" apart per route without pulling in a metrics
 * library for a handful of counters.
 */
const LATENCY_BUCKET_BOUNDS_MS: readonly number[] = [
  5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000
];

interface Histogram {
  /** Cumulative counts aligned to LATENCY_BUCKET_BOUNDS_MS (Prometheus "le" convention). */
  bucketCounts: number[];
  sum: number;
  count: number;
}

function newHistogram(): Histogram {
  return { bucketCounts: LATENCY_BUCKET_BOUNDS_MS.map(() => 0), sum: 0, count: 0 };
}

function observe(histogram: Histogram, durationMs: number): void {
  histogram.count += 1;
  histogram.sum += durationMs;
  for (const [index, bound] of LATENCY_BUCKET_BOUNDS_MS.entries()) {
    if (durationMs <= bound) histogram.bucketCounts[index]! += 1;
  }
}

interface LatencyEntry {
  method: string;
  route: string;
  histogram: Histogram;
}

interface StatusEntry {
  method: string;
  route: string;
  statusCode: number;
  count: number;
}

/**
 * In-memory registry of request latency and response counts, keyed by
 * method + route *pattern* (e.g. `/api/v1/contacts/:id`, never the literal
 * URL with a real id in it - see the onResponse hook in src/app.ts, which is
 * the only writer). Using the route pattern instead of the raw URL is what
 * keeps the label cardinality bounded to "one series per endpoint this
 * service defines", regardless of how many distinct contacts/deals/etc a
 * partner requests.
 */
export class MetricsRegistry {
  private readonly latency = new Map<string, LatencyEntry>();
  private readonly statusCounts = new Map<string, StatusEntry>();

  recordResponse(method: string, route: string, statusCode: number, durationMs: number): void {
    const key = `${method} ${route}`;
    const latencyEntry = this.latency.get(key);
    if (latencyEntry === undefined) {
      const histogram = newHistogram();
      observe(histogram, durationMs);
      this.latency.set(key, { method, route, histogram });
    } else {
      observe(latencyEntry.histogram, durationMs);
    }

    const statusKey = `${key} ${statusCode}`;
    const statusEntry = this.statusCounts.get(statusKey);
    if (statusEntry === undefined) {
      this.statusCounts.set(statusKey, { method, route, statusCode, count: 1 });
    } else {
      statusEntry.count += 1;
    }
  }

  /** Read-only snapshot for the text formatter below; never mutated by callers. */
  snapshot(): { latency: LatencyEntry[]; statusCounts: StatusEntry[] } {
    return {
      latency: [...this.latency.values()],
      statusCounts: [...this.statusCounts.values()]
    };
  }
}

/**
 * Outbox/webhook figures as of the moment they were queried - never cached,
 * never accumulated. See PostgresMetricsQueries.collect for the exact SQL
 * and the reasoning behind each one.
 */
export interface OutboxWebhookMetrics {
  /**
   * Age, in seconds, of the oldest unprocessed outbox row
   * (`processed_at IS NULL`), i.e. how long the longest-waiting event has
   * been sitting in `integration_api_outbox` without being claimed by the
   * webhook worker. `null` when there is no pending row (nothing to lag
   * behind on).
   */
  outboxLagSeconds: number | null;
  /** COUNT(*) of `integration_api_webhook_deliveries` rows with status = 'dead'. */
  deadLetterCount: number;
  /**
   * Deliveries that needed more than one attempt before reaching a terminal
   * state (delivered or dead) - see the design-decision comment on
   * PostgresMetricsQueries.collect for why this is the interpretation of
   * "duplicados" used here.
   */
  duplicateDeliveryCount: number;
}

export interface MetricsQueries {
  collect(): Promise<OutboxWebhookMetrics>;
}

export class PostgresMetricsQueries implements MetricsQueries {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Design decision on "duplicados" (src/http/metrics.ts, per the phase
   * plan): the plan asks for a "duplicates" metric for the outbox/webhook
   * pipeline but does not define the term, and nothing in
   * migrations/001_integration_api.sql models a duplicate *delivery* as a
   * distinct row - a webhook event is delivered to a given endpoint at most
   * once per outbox row (UNIQUE (endpoint_id, outbox_id), enforced with
   * ON CONFLICT DO NOTHING in src/webhooks/deliveries.ts claimBatch), so
   * there is no literal duplicate row to count without inventing a table or
   * column that does not exist.
   *
   * What *can* happen, and is visible in the data we already have, is a
   * delivery that had to be retried - i.e. the receiving endpoint may have
   * received the same webhook payload more than once before the delivery
   * finally reached a terminal state, because our own retry logic
   * (src/webhooks/worker.ts) re-sends on failure. From the partner's side,
   * that is exactly what "a duplicate" looks like: the same event_id
   * arriving at their endpoint more than once. `attempt_count > 1` on
   * `integration_api_webhook_deliveries` is the closest available proxy for
   * that - it counts deliveries that made at least one retry attempt, which
   * is an upper bound on possible partner-visible duplicates (a retry only
   * means we tried again, not that the first attempt was necessarily
   * received - the original request could have timed out or failed before
   * the partner's endpoint ever saw it). It is documented here as an
   * approximation, not an exact count of partner-observed duplicate
   * receipts, which this service cannot know without partner-side
   * acknowledgement it does not collect.
   */
  async collect(): Promise<OutboxWebhookMetrics> {
    const lagResult = await this.pool.query<{ lag_seconds: number | string | null }>(
      `SELECT EXTRACT(EPOCH FROM (NOW() - MIN(occurred_at))) AS lag_seconds
         FROM integration_api_outbox
        WHERE processed_at IS NULL`
    );
    const deadResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
         FROM integration_api_webhook_deliveries
        WHERE status = 'dead'`
    );
    const duplicateResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
         FROM integration_api_webhook_deliveries
        WHERE attempt_count > 1`
    );

    const rawLag = lagResult.rows[0]?.lag_seconds ?? null;
    return {
      outboxLagSeconds: rawLag === null ? null : Number(rawLag),
      deadLetterCount: Number(deadResult.rows[0]?.count ?? 0),
      duplicateDeliveryCount: Number(duplicateResult.rows[0]?.count ?? 0)
    };
  }
}

function statusClassOf(statusCode: number): "2xx" | "3xx" | "4xx" | "5xx" | "other" {
  if (statusCode >= 200 && statusCode < 300) return "2xx";
  if (statusCode >= 300 && statusCode < 400) return "3xx";
  if (statusCode >= 400 && statusCode < 500) return "4xx";
  if (statusCode >= 500 && statusCode < 600) return "5xx";
  return "other";
}

/** Escapes a Prometheus label value: backslash, double quote and newline are the only reserved characters. */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n");
}

function labels(pairs: Array<[string, string]>): string {
  return `{${pairs.map(([name, value]) => `${name}="${escapeLabel(value)}"`).join(",")}}`;
}

/**
 * Renders the current in-memory registry plus a freshly-collected
 * OutboxWebhookMetrics snapshot as Prometheus text exposition format
 * (https://prometheus.io/docs/instrumenting/exposition_formats/). Deliberately
 * hand-rolled: the metric set here is small and fixed, and the format itself
 * is plain text, so pulling in a client library (see package.json - none of
 * `fastify`/`pg`/`zod` provide this) would add a dependency for something a
 * few `Array.prototype.join` calls already do.
 *
 * Counters are exposed raw (request counts, not already-divided rates) -
 * consumers (Prometheus `rate()`/`increase()`, or a dashboard doing the same
 * math) are expected to derive rates over whatever window they want, which is
 * the standard way Prometheus counters are meant to be consumed.
 */
export function renderPrometheusText(
  registry: MetricsRegistry,
  outboxWebhookMetrics: OutboxWebhookMetrics
): string {
  const { latency, statusCounts } = registry.snapshot();
  const lines: string[] = [];

  lines.push("# HELP integration_api_http_request_duration_ms HTTP request latency in milliseconds, by method and route.");
  lines.push("# TYPE integration_api_http_request_duration_ms histogram");
  for (const entry of latency) {
    const baseLabels: Array<[string, string]> = [["method", entry.method], ["route", entry.route]];
    for (const [index, bound] of LATENCY_BUCKET_BOUNDS_MS.entries()) {
      const bucketLabels = labels([...baseLabels, ["le", String(bound)]]);
      lines.push(`integration_api_http_request_duration_ms_bucket${bucketLabels} ${entry.histogram.bucketCounts[index]}`);
    }
    const infLabels = labels([...baseLabels, ["le", "+Inf"]]);
    lines.push(`integration_api_http_request_duration_ms_bucket${infLabels} ${entry.histogram.count}`);
    lines.push(`integration_api_http_request_duration_ms_sum${labels(baseLabels)} ${entry.histogram.sum}`);
    lines.push(`integration_api_http_request_duration_ms_count${labels(baseLabels)} ${entry.histogram.count}`);
  }

  lines.push("# HELP integration_api_http_responses_total HTTP responses, by method, route and exact status code.");
  lines.push("# TYPE integration_api_http_responses_total counter");
  for (const entry of statusCounts) {
    const entryLabels = labels([
      ["method", entry.method],
      ["route", entry.route],
      ["status_code", String(entry.statusCode)]
    ]);
    lines.push(`integration_api_http_responses_total${entryLabels} ${entry.count}`);
  }

  // Derived from the same per-status-code counts above, not tracked
  // separately - one exact-count map is enough to answer both "how many 404s
  // on this route" and "what's this route's overall error rate".
  const byClass = new Map<string, { method: string; route: string; statusClass: string; count: number }>();
  for (const entry of statusCounts) {
    const statusClass = statusClassOf(entry.statusCode);
    const key = `${entry.method} ${entry.route} ${statusClass}`;
    const existing = byClass.get(key);
    if (existing === undefined) {
      byClass.set(key, { method: entry.method, route: entry.route, statusClass, count: entry.count });
    } else {
      existing.count += entry.count;
    }
  }
  lines.push("# HELP integration_api_http_responses_by_class_total HTTP responses, by method, route and status class (2xx/3xx/4xx/5xx).");
  lines.push("# TYPE integration_api_http_responses_by_class_total counter");
  for (const entry of byClass.values()) {
    const entryLabels = labels([
      ["method", entry.method],
      ["route", entry.route],
      ["status_class", entry.statusClass]
    ]);
    lines.push(`integration_api_http_responses_by_class_total${entryLabels} ${entry.count}`);
  }

  lines.push("# HELP integration_api_outbox_lag_seconds Age in seconds of the oldest unprocessed integration_api_outbox row (0 when there is no pending row).");
  lines.push("# TYPE integration_api_outbox_lag_seconds gauge");
  lines.push(`integration_api_outbox_lag_seconds ${outboxWebhookMetrics.outboxLagSeconds ?? 0}`);

  lines.push("# HELP integration_api_webhook_dead_letters Webhook deliveries currently in the dead state (integration_api_webhook_deliveries.status = 'dead').");
  lines.push("# TYPE integration_api_webhook_dead_letters gauge");
  lines.push(`integration_api_webhook_dead_letters ${outboxWebhookMetrics.deadLetterCount}`);

  lines.push("# HELP integration_api_webhook_duplicate_deliveries Webhook deliveries that needed more than one attempt (attempt_count > 1) - see PostgresMetricsQueries.collect in src/http/metrics.ts for the exact interpretation.");
  lines.push("# TYPE integration_api_webhook_duplicate_deliveries gauge");
  lines.push(`integration_api_webhook_duplicate_deliveries ${outboxWebhookMetrics.duplicateDeliveryCount}`);

  return `${lines.join("\n")}\n`;
}
