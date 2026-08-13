import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { ApiError } from "../http/errors.js";

function privateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  const first = parts[0] ?? -1;
  const second = parts[1] ?? -1;
  return first === 0 || first === 10 || first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) || first >= 224;
}

function privateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.");
}

function unsafeAddress(address: string): boolean {
  const version = isIP(address);
  return version === 4 ? privateIpv4(address) : version === 6 ? privateIpv6(address) : true;
}

export async function assertSafeMediaUrl(value: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "unsafe_media_url", "The media URL is not safe");
  }
  if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password) {
    throw new ApiError(400, "unsafe_media_url", "The media URL is not safe");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) === 0
    ? await lookup(hostname, { all: true, verbatim: true }).catch(() => [])
    : [{ address: hostname }];
  if (addresses.length === 0 || addresses.some(({ address }) => unsafeAddress(address))) {
    throw new ApiError(400, "unsafe_media_url", "The media URL is not safe");
  }
}
