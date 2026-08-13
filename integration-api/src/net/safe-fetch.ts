import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { isBlockedIpAddress } from "./ip-rules.js";
import {
  assertSafeAddresses,
  normalizeHostname,
  parseDestination,
  UnsafeDestinationError,
  type HostResolver
} from "./destination.js";

export interface SafeFetchOptions {
  /** Redirects are refused by default: a webhook receiver has no reason to bounce us. */
  maxRedirects?: number;
  timeoutMs?: number;
  resolve?: HostResolver;
  isAddressBlocked?: (address: string) => boolean;
  maxResponseBytes?: number;
}

const allowedProtocols = ["http:", "https:"] as const;

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number
) => void;

/**
 * A DNS lookup that only ever hands the socket an address it has already
 * cleared. Validation and connection therefore share one answer, which is what
 * closes the rebinding window that a validate-then-fetch design leaves open.
 */
function guardedLookup(
  resolve: HostResolver | undefined,
  isBlocked: (address: string) => boolean
) {
  return (
    hostname: string,
    options: { all?: boolean } | number,
    callback: LookupCallback
  ): void => {
    const wantsAll = typeof options === "object" && options.all === true;
    assertSafeAddresses(hostname, { protocols: allowedProtocols, resolve, isAddressBlocked: isBlocked })
      .then((addresses) => {
        const chosen = addresses[0]!;
        const family = isIP(chosen) === 6 ? 6 : 4;
        if (wantsAll) callback(null, [{ address: chosen, family }]);
        else callback(null, chosen, family);
      })
      .catch((error: unknown) => {
        const failure = error instanceof Error ? error : new UnsafeDestinationError();
        callback(failure as NodeJS.ErrnoException, "", 0);
      });
  };
}

interface RawResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: Buffer;
}

function collectHeaders(message: IncomingMessage): [string, string][] {
  const headers: [string, string][] = [];
  for (const [name, value] of Object.entries(message.headers)) {
    if (value === undefined) continue;
    headers.push([name, Array.isArray(value) ? value.join(", ") : value]);
  }
  return headers;
}

async function performRequest(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  options: Required<Pick<SafeFetchOptions, "timeoutMs" | "maxResponseBytes">> &
    Pick<SafeFetchOptions, "resolve" | "isAddressBlocked">,
  signal: AbortSignal | null
): Promise<RawResponse> {
  const isBlocked = options.isAddressBlocked ?? isBlockedIpAddress;
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  const hostname = normalizeHostname(url.hostname);

  return new Promise<RawResponse>((resolve, reject) => {
    const request = send({
      protocol: url.protocol,
      hostname,
      port: url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port),
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      lookup: guardedLookup(options.resolve, isBlocked),
      servername: isIP(hostname) === 0 ? hostname : undefined
    }, (message) => {
      const chunks: Buffer[] = [];
      let size = 0;
      message.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > options.maxResponseBytes) {
          message.destroy();
          reject(new Error("The destination response exceeded the allowed size"));
          return;
        }
        chunks.push(chunk);
      });
      message.on("end", () => resolve({
        status: message.statusCode ?? 0,
        statusText: message.statusMessage ?? "",
        headers: collectHeaders(message),
        body: Buffer.concat(chunks)
      }));
      message.on("error", reject);
    });

    const abort = () => request.destroy(new Error("The destination request was aborted"));
    signal?.addEventListener("abort", abort, { once: true });
    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error("The destination request timed out"));
    });
    request.on("error", reject);
    request.on("close", () => signal?.removeEventListener("abort", abort));

    if (body !== undefined && body !== "") request.write(body);
    request.end();
  });
}

function redirectTarget(response: RawResponse, current: URL): URL | null {
  if (![301, 302, 303, 307, 308].includes(response.status)) return null;
  const location = response.headers.find(([name]) => name.toLowerCase() === "location")?.[1];
  if (location === undefined || location === "") return null;
  try {
    return new URL(location, current);
  } catch {
    throw new UnsafeDestinationError("The redirect target could not be parsed");
  }
}

/**
 * A fetch-shaped function that is safe to point at partner-controlled URLs.
 * Every hop is resolved and cleared independently; nothing is inherited from
 * the verdict of the previous hop.
 */
export function createSafeFetch(options: SafeFetchOptions = {}) {
  const maxRedirects = options.maxRedirects ?? 0;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxResponseBytes = options.maxResponseBytes ?? 1_048_576;

  return async function safeFetch(request: Request): Promise<Response> {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => { headers[name] = value; });
    let body: string | undefined = await request.text();
    if (body === "") body = undefined;
    let method = request.method;
    let url = parseDestination(request.url, allowedProtocols);

    for (let hop = 0; ; hop += 1) {
      await assertSafeAddresses(url.hostname, {
        protocols: allowedProtocols,
        resolve: options.resolve,
        isAddressBlocked: options.isAddressBlocked
      });

      const response = await performRequest(
        url,
        method,
        { ...headers, host: url.host, ...(body === undefined ? {} : { "content-length": String(Buffer.byteLength(body)) }) },
        body,
        { timeoutMs, maxResponseBytes, resolve: options.resolve, isAddressBlocked: options.isAddressBlocked },
        request.signal
      );

      const next = maxRedirects > 0 ? redirectTarget(response, url) : null;
      if (next === null) {
        return new Response(response.body.length === 0 ? null : new Uint8Array(response.body), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }
      if (hop >= maxRedirects) {
        throw new UnsafeDestinationError("The destination exceeded the redirect budget");
      }
      if (!allowedProtocols.includes(next.protocol as (typeof allowedProtocols)[number])) {
        throw new UnsafeDestinationError("The redirect target protocol is not allowed");
      }
      if (next.username !== "" || next.password !== "") {
        throw new UnsafeDestinationError("The redirect target must not carry credentials");
      }
      if ([301, 302, 303].includes(response.status)) {
        method = "GET";
        body = undefined;
      }
      url = next;
    }
  };
}
