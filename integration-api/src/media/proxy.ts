import { fetchRemoteMedia, type MediaFetchPolicy, type MediaKind } from "./fetch.js";
import type { MediaStore } from "./store.js";

export interface MediaProxy {
  prepare(url: string, kind: MediaKind): Promise<string>;
}

/**
 * Replaces a partner URL with one the engine can trust. The engine never learns
 * the original address, so it cannot be steered anywhere by a name that answers
 * differently on the second lookup.
 */
export class DownloadingMediaProxy implements MediaProxy {
  constructor(
    private readonly store: MediaStore,
    private readonly policy: MediaFetchPolicy
  ) {}

  async prepare(url: string, kind: MediaKind): Promise<string> {
    const media = await fetchRemoteMedia(url, kind, this.policy);
    const stored = await this.store.put(media.bytes, media.contentType);
    return stored.url;
  }
}
