import { isIP } from "node:net";

function parseIpv4(value: string): Uint8Array | null {
  if (isIP(value) !== 4) return null;
  const bytes = new Uint8Array(4);
  const parts = value.split(".");
  for (let index = 0; index < 4; index += 1) bytes[index] = Number(parts[index]);
  return bytes;
}

function parseIpv6(value: string): Uint8Array | null {
  const text = value.split("%")[0] ?? "";
  if (isIP(text) !== 6) return null;

  let normalized = text;
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized);
  if (dotted !== null) {
    const embedded = parseIpv4(dotted[1]!);
    if (embedded === null) return null;
    const high = ((embedded[0]! << 8) | embedded[1]!).toString(16);
    const low = ((embedded[2]! << 8) | embedded[3]!).toString(16);
    normalized = `${normalized.slice(0, dotted.index)}${high}:${low}`;
  }

  let groups: string[];
  if (normalized.includes("::")) {
    const [left = "", right = ""] = normalized.split("::");
    const head = left === "" ? [] : left.split(":");
    const tail = right === "" ? [] : right.split(":");
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  } else {
    groups = normalized.split(":");
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let index = 0; index < 8; index += 1) {
    const group = Number.parseInt(groups[index]!, 16);
    if (!Number.isInteger(group) || group < 0 || group > 0xffff) return null;
    bytes[index * 2] = group >> 8;
    bytes[index * 2 + 1] = group & 0xff;
  }
  return bytes;
}

/**
 * Blocks every IPv4 range that is not globally routable public unicast:
 * this software must never be able to reach the host, the Docker network,
 * the VPS LAN or a cloud metadata endpoint on behalf of a partner.
 */
function blockedIpv4(bytes: Uint8Array): boolean {
  const [a = 0, b = 0, c = 0] = bytes;
  if (a === 0) return true;                                   // 0.0.0.0/8 "this network"
  if (a === 10) return true;                                  // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true;          // RFC6598 CGNAT
  if (a === 127) return true;                                 // loopback
  if (a === 169 && b === 254) return true;                    // link-local and cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;           // RFC1918
  if (a === 192 && b === 0 && c === 0) return true;           // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true;           // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true;         // 6to4 relay anycast
  if (a === 192 && b === 168) return true;                    // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true;       // benchmarking
  if (a === 198 && b === 51 && c === 100) return true;        // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;         // TEST-NET-3
  if (a >= 224) return true;                                  // multicast, reserved, broadcast
  return false;
}

function allZero(bytes: Uint8Array, from: number, to: number): boolean {
  for (let index = from; index < to; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return true;
}

/**
 * The IPv4-mapped `0xffff` marker sits at bytes[10:12] canonically
 * (`::ffff:0:0/96`), but zero-compression can legally shift it earlier: the
 * literal `::ffff:0:127.0.0.1` parses to `0:0:0:0:ffff:0:7f00:1`, putting the
 * marker at bytes[8:10] with an explicit zero group after it. Scanning every
 * 16-bit-aligned position instead of trusting one fixed offset closes that
 * regardless of how many zero groups separate the marker from the embedded
 * address.
 */
function ipv4MappedMarkerAt(bytes: Uint8Array): boolean {
  for (let marker = 2; marker <= 10; marker += 2) {
    if (allZero(bytes, 0, marker) && bytes[marker] === 0xff && bytes[marker + 1] === 0xff &&
        allZero(bytes, marker + 2, 12)) {
      return true;
    }
  }
  return false;
}

/**
 * Any IPv6 form that can carry an embedded IPv4 destination is unwrapped and
 * re-checked with the IPv4 rules, so `::ffff:127.0.0.1` cannot smuggle loopback.
 */
function blockedIpv6(bytes: Uint8Array): boolean {
  if (ipv4MappedMarkerAt(bytes)) {
    return blockedIpv4(bytes.subarray(12));                   // IPv4-mapped, canonical or shifted
  }
  if (allZero(bytes, 0, 12)) return true;                     // ::, ::1 and IPv4-compatible
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b &&
      allZero(bytes, 4, 12)) {
    return blockedIpv4(bytes.subarray(12));                   // NAT64 64:ff9b::/96
  }
  if (bytes[0] === 0x01 && bytes[1] === 0x00 && allZero(bytes, 2, 8)) return true; // 100::/64 discard
  if ((bytes[0]! & 0xfe) === 0xfc) return true;               // fc00::/7 unique local
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0xc0) return true; // fec0::/10 site-local
  if (bytes[0] === 0xff) return true;                         // multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return true;    // 2002::/16 6to4 wraps IPv4
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return true;                                              // 2001:db8::/32 documentation
  }
  return false;
}

/**
 * Returns true for anything that must not be contacted. Unparsable input is
 * blocked on purpose: an address we cannot classify is not an address we trust.
 */
export function isBlockedIpAddress(address: string): boolean {
  const version = isIP(address.split("%")[0] ?? "");
  if (version === 4) return blockedIpv4(parseIpv4(address)!);
  if (version === 6) {
    const bytes = parseIpv6(address);
    return bytes === null ? true : blockedIpv6(bytes);
  }
  return true;
}
