import { lookup } from "node:dns/promises";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type WebhookResolver = (
  hostname: string,
  options: { all: true; verbatim: true }
) => Promise<ResolvedAddress[]>;

export class UnsafeWebhookUrlError extends Error {
  constructor() {
    super("The webhook URL is not safe");
    this.name = "UnsafeWebhookUrlError";
  }
}

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}

const publicIpv6 = new BlockList();
publicIpv6.addSubnet("2000::", 3, "ipv6");

const blockedIpv6 = new BlockList();
blockedIpv6.addSubnet("2001::", 23, "ipv6");
blockedIpv6.addSubnet("2001:db8::", 32, "ipv6");
blockedIpv6.addSubnet("2002::", 16, "ipv6");
blockedIpv6.addSubnet("3fff::", 20, "ipv6");

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedIpv4.check(address, "ipv4");
  if (family === 6) {
    return publicIpv6.check(address, "ipv6") && !blockedIpv6.check(address, "ipv6");
  }
  return false;
}

export interface AuthorizedWebhookTarget {
  url: URL;
  addresses: ResolvedAddress[];
}

export async function authorizeWebhookUrl(
  value: string | URL,
  resolver: WebhookResolver = lookup
): Promise<AuthorizedWebhookTarget> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafeWebhookUrlError();
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new UnsafeWebhookUrlError();
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname.toLowerCase() === "localhost" || isIP(hostname) !== 0) {
    throw new UnsafeWebhookUrlError();
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeWebhookUrlError();
  }
  if (addresses.length === 0 || addresses.some(({ address, family }) =>
    family !== isIP(address) || !isPublicAddress(address)
  )) {
    throw new UnsafeWebhookUrlError();
  }
  return { url, addresses };
}

function fixedLookup(resolved: ResolvedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [resolved]);
      return;
    }
    callback(null, resolved.address, resolved.family);
  };
}

function responseHeaders(values: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

async function sendPinnedHttpsRequest(
  target: AuthorizedWebhookTarget,
  method: string,
  headers: Headers,
  body: Buffer | undefined,
  signal: AbortSignal
): Promise<Response> {
  const resolved = target.addresses[0];
  if (resolved === undefined) throw new UnsafeWebhookUrlError();

  return new Promise((resolve, reject) => {
    const outgoing = httpsRequest(target.url, {
      agent: false,
      headers: Object.fromEntries(headers.entries()),
      lookup: fixedLookup(resolved),
      method,
      servername: target.url.hostname,
      signal
    }, (incoming) => {
      incoming.resume();
      const status = incoming.statusCode;
      if (status === undefined) {
        reject(new Error("Webhook response did not include a status code"));
        return;
      }
      resolve(new Response(null, { headers: responseHeaders(incoming.headers), status }));
    });
    outgoing.once("error", reject);
    outgoing.end(body);
  });
}

const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const maxRedirects = 20;

export async function secureWebhookFetch(request: Request): Promise<Response> {
  let url = new URL(request.url);
  let method = request.method;
  let headers = new Headers(request.headers);
  let body = request.body === null
    ? undefined
    : Buffer.from(await request.clone().arrayBuffer());

  for (let redirects = 0; ; redirects += 1) {
    const target = await authorizeWebhookUrl(url);
    const response = await sendPinnedHttpsRequest(target, method, headers, body, request.signal);
    const location = response.headers.get("location");
    if (!redirectStatuses.has(response.status) || location === null) return response;
    if (redirects >= maxRedirects) throw new Error("Webhook redirect limit exceeded");

    const nextUrl = new URL(location, url);
    if (nextUrl.origin !== url.origin) {
      headers.delete("authorization");
      headers.delete("cookie");
      headers.delete("proxy-authorization");
    }
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
      headers.delete("content-encoding");
      headers.delete("content-language");
      headers.delete("content-location");
      headers.delete("content-type");
    }
    url = nextUrl;
  }
}
