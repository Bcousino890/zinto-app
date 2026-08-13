import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { isBlockedIpAddress } from "./ip-rules.js";

export class UnsafeDestinationError extends Error {
  constructor(message = "The destination is not allowed") {
    super(message);
    this.name = "UnsafeDestinationError";
  }
}

export type HostResolver = (hostname: string) => Promise<string[]>;

export const resolveHostAddresses: HostResolver = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
};

export interface DestinationPolicy {
  protocols: readonly string[];
  resolve?: HostResolver;
  isAddressBlocked?: (address: string) => boolean;
}

export function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "");
}

export function parseDestination(value: string, protocols: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafeDestinationError("The destination URL could not be parsed");
  }
  if (!protocols.includes(url.protocol)) {
    throw new UnsafeDestinationError("The destination protocol is not allowed");
  }
  if (url.username !== "" || url.password !== "") {
    throw new UnsafeDestinationError("The destination must not carry credentials");
  }
  return url;
}

/**
 * Resolves the hostname and rejects the destination unless *every* returned
 * address is public. Requiring all of them — not just the one we would connect
 * to — removes the race where a hostname answers with one public and one
 * private address and the runtime happens to pick the private one.
 */
export async function assertSafeAddresses(
  hostname: string,
  policy: DestinationPolicy
): Promise<string[]> {
  const isBlocked = policy.isAddressBlocked ?? isBlockedIpAddress;
  const host = normalizeHostname(hostname);

  if (isIP(host) !== 0) {
    if (isBlocked(host)) throw new UnsafeDestinationError("The destination address is not allowed");
    return [host];
  }

  let addresses: string[];
  try {
    addresses = await (policy.resolve ?? resolveHostAddresses)(host);
  } catch {
    throw new UnsafeDestinationError("The destination hostname could not be resolved");
  }
  if (addresses.length === 0) {
    throw new UnsafeDestinationError("The destination hostname did not resolve");
  }
  if (addresses.some((address) => isBlocked(address))) {
    throw new UnsafeDestinationError("The destination resolves to a blocked address");
  }
  return addresses;
}

export async function assertSafeDestination(
  value: string,
  policy: DestinationPolicy
): Promise<void> {
  const url = parseDestination(value, policy.protocols);
  await assertSafeAddresses(url.hostname, policy);
}
