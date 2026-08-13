import { ApiError } from "../http/errors.js";
import { UnsafeDestinationError, type HostResolver } from "../net/destination.js";
import { createSafeFetch } from "../net/safe-fetch.js";

export type MediaKind = "image" | "video" | "audio" | "document";

export interface RemoteMedia {
  bytes: Uint8Array;
  contentType: string;
}

export interface MediaFetchPolicy {
  maxBytes: number;
  timeoutMs: number;
  resolve?: HostResolver;
  fetch?: (request: Request) => Promise<Response>;
}

/**
 * A document may be almost anything, so it is defined by what it must not be:
 * markup and scripts are refused because the engine and its downstream clients
 * would be handing an active payload to a recipient.
 */
const forbiddenDocumentTypes = ["text/html", "application/xhtml+xml", "text/javascript", "application/javascript"];

function contentTypeMatches(kind: MediaKind, contentType: string): boolean {
  const normalized = contentType.split(";")[0]!.trim().toLowerCase();
  if (kind === "document") {
    return normalized !== "" && !forbiddenDocumentTypes.includes(normalized);
  }
  return normalized.startsWith(`${kind}/`);
}

/**
 * Downloads partner-supplied media through the pinned fetcher so the address we
 * cleared is the address we read from. Handing the legacy engine a URL it
 * resolves itself is what leaves the rebinding window open; this closes it by
 * making the download ours.
 */
export async function fetchRemoteMedia(
  url: string,
  kind: MediaKind,
  policy: MediaFetchPolicy
): Promise<RemoteMedia> {
  const download = policy.fetch ?? createSafeFetch({
    timeoutMs: policy.timeoutMs,
    maxResponseBytes: policy.maxBytes,
    resolve: policy.resolve
  });

  let response: Response;
  try {
    response = await download(new Request(url, { method: "GET" }));
  } catch (error) {
    if (error instanceof UnsafeDestinationError) {
      throw new ApiError(400, "unsafe_media_url", "The media URL is not safe");
    }
    if (error instanceof Error && /exceeded the allowed size/.test(error.message)) {
      throw new ApiError(400, "media_too_large", "The media exceeds the allowed size");
    }
    throw new ApiError(400, "media_unreachable", "The media could not be retrieved");
  }

  if (!response.ok) {
    throw new ApiError(400, "media_unreachable", "The media could not be retrieved");
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > policy.maxBytes) {
    throw new ApiError(400, "media_too_large", "The media exceeds the allowed size");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentTypeMatches(kind, contentType)) {
    throw new ApiError(400, "media_type_mismatch", "The media does not match the declared type");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > policy.maxBytes) {
    throw new ApiError(400, "media_too_large", "The media exceeds the allowed size");
  }

  return { bytes, contentType: contentType.split(";")[0]!.trim() };
}
