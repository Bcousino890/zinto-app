import { fetchRemoteMedia, type MediaFetchPolicy, type MediaKind } from "./fetch.js";
import type { MediaStore } from "./store.js";

export interface MediaProxy {
  prepare(url: string, kind: MediaKind): Promise<string>;
}

/** The rest of MediaFetchPolicy, minus the per-kind byte cap resolved below. */
export type SharedMediaFetchPolicy = Omit<MediaFetchPolicy, "maxBytes">;

/**
 * WhatsApp Business API caps media size differently per kind, so one shared
 * `maxBytes` cannot represent the real limit for all four - see
 * MEDIA_MAX_BYTES_IMAGE/VIDEO/AUDIO/DOCUMENT in src/config.ts.
 */
export type MediaSizeLimits = Record<MediaKind, number>;

/**
 * Replaces a partner URL with one the engine can trust. The engine never learns
 * the original address, so it cannot be steered anywhere by a name that answers
 * differently on the second lookup.
 */
export class DownloadingMediaProxy implements MediaProxy {
  constructor(
    private readonly store: MediaStore,
    private readonly policy: SharedMediaFetchPolicy,
    private readonly maxBytesByKind: MediaSizeLimits
  ) {}

  async prepare(url: string, kind: MediaKind): Promise<string> {
    // The byte cap is resolved per request from `kind`, not fixed at
    // construction time, so an image and a document sent through the same
    // proxy instance are held to their own real-world limit.
    const media = await fetchRemoteMedia(url, kind, { ...this.policy, maxBytes: this.maxBytesByKind[kind] });
    const stored = await this.store.put(media.bytes, media.contentType);
    return stored.url;
  }
}
