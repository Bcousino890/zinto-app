import type { FastifyReply, FastifyRequest } from "fastify";

import { ApiError } from "./errors.js";

export interface RateLimitConfig {
  /** Shared fixed-window size for every bucket. */
  windowMs: number;
  perKeyMax: number;
  perCompanyMax: number;
  perIpMax: number;
}

/**
 * The per-key bucket is the primary throttle for a well-behaved single-key
 * integration. The IP bucket sits above it: it guards against abuse that
 * rotates keys, or that never presents a valid key at all (brute forcing,
 * scraping), so it must be generous enough not to trip on one IP running a
 * couple of legitimate keys. The company bucket is the broadest net, roughly
 * scaled for a handful of concurrent keys per company. A 1-minute window is
 * short enough to recover quickly from a burst without needing an operator.
 */
export const defaultRateLimitConfig: RateLimitConfig = {
  windowMs: 60_000,
  perKeyMax: 300,
  perCompanyMax: 1_200,
  perIpMax: 600
};

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window counters kept in a process-local Map. This is enough for a
 * single replica: every instance enforces its own limit independently, so
 * running N replicas behind the load balancer multiplies the effective
 * ceiling by N (a key limited to 300/min on one replica could reach 300*N/min
 * split across replicas). A distributed limiter would need a shared store
 * (e.g. Redis INCR+EXPIRE or a sliding-window Lua script) keyed the same way
 * as the buckets below, so this class is deliberately the only place that
 * would need to change.
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly config: RateLimitConfig,
    private readonly now: () => number = Date.now
  ) {}

  checkApiKey(apiKeyId: number): number | null {
    return this.consume(`key:${apiKeyId}`, this.config.perKeyMax);
  }

  checkCompany(companyId: number): number | null {
    return this.consume(`company:${companyId}`, this.config.perCompanyMax);
  }

  checkIp(ip: string): number | null {
    return this.consume(`ip:${ip}`, this.config.perIpMax);
  }

  /** Returns null when the request is allowed, or the retry-after seconds when it is not. */
  private consume(bucket: string, max: number): number | null {
    const current = this.now();
    const existing = this.windows.get(bucket);
    if (existing === undefined || existing.resetAt <= current) {
      this.windows.set(bucket, { count: 1, resetAt: current + this.config.windowMs });
      return null;
    }
    if (existing.count >= max) {
      return Math.max(1, Math.ceil((existing.resetAt - current) / 1000));
    }
    existing.count += 1;
    return null;
  }
}

export function rateLimitError(retryAfterSeconds: number): ApiError {
  return new ApiError(429, "rate_limit_exceeded", "Too many requests; retry later", {
    "Retry-After": String(retryAfterSeconds)
  });
}

/**
 * Applied globally to `/api/v1/*` before authentication runs, so it also
 * bounds unauthenticated traffic (invalid or missing keys) from one address.
 * Per-key and per-company limits are enforced separately, inside
 * createApiKeyAuthenticator, because they need the identity that only auth
 * resolves.
 */
export function createIpRateLimitHook(limiter: RateLimiter) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.url.startsWith("/api/v1/")) return;
    const retryAfter = limiter.checkIp(request.ip);
    if (retryAfter !== null) throw rateLimitError(retryAfter);
  };
}
