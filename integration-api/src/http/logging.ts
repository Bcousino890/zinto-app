import type { FastifyRequest } from "fastify";

/**
 * Fastify's default request serializer logs `req.url` verbatim. This API only
 * ever expects the API key in the Authorization header, but a partner can
 * still paste it (or any other secret) into a query parameter by mistake, and
 * that would otherwise land in every access log line. Anything shaped like our
 * `pcp_<64 hex>` key is stripped wherever it appears in the URL, and a handful
 * of conventionally sensitive parameter names are redacted outright.
 */
const sensitiveQueryParams = new Set(["token", "api_key", "apikey", "key", "secret", "password"]);
const apiKeyPattern = /pcp_[a-f0-9]{64}/gi;

export function redactUrl(rawUrl: string): string {
  const queryIndex = rawUrl.indexOf("?");
  if (queryIndex === -1) return redactTokens(rawUrl);

  const path = rawUrl.slice(0, queryIndex);
  const params = new URLSearchParams(rawUrl.slice(queryIndex + 1));
  for (const name of params.keys()) {
    if (sensitiveQueryParams.has(name.toLowerCase())) params.set(name, "REDACTED");
  }
  const query = redactTokens(params.toString());
  return query === "" ? path : `${path}?${query}`;
}

function redactTokens(value: string): string {
  return value.replace(apiKeyPattern, "REDACTED");
}

export interface SecureLoggerOptions {
  level: string;
  redact: string[];
  serializers: {
    req: (request: FastifyRequest) => {
      method: string;
      url: string;
      host: string;
      remoteAddress: string;
    };
  };
}

/**
 * The one logger config every entrypoint should build from: the production
 * server (`src/server.ts`) and, as a safety net, `buildApp`'s own default
 * when no logger is supplied. Request and response bodies are never included
 * here on purpose — Fastify's default serializers already omit them, and this
 * config must not become the place that starts logging one. Returns a plain
 * object (not Fastify's own broad logger union type) so callers, including
 * tests, can spread it and add a `stream`.
 */
export function secureLoggerOptions(level = "info"): SecureLoggerOptions {
  return {
    level,
    redact: ["req.headers.authorization", "req.headers.cookie"],
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: redactUrl(request.url),
          host: request.host,
          remoteAddress: request.ip
        };
      }
    }
  };
}
