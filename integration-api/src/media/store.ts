import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface StoredMedia {
  id: string;
  url: string;
  contentType: string;
  bytes: number;
}

export interface MediaStore {
  put(bytes: Uint8Array, contentType: string): Promise<StoredMedia>;
  get(id: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  purge(before: Date): Promise<number>;
}

const identifier = /^[a-f0-9]{64}$/;

/**
 * Names are random rather than derived from anything the partner sent: the
 * identifier is the only thing protecting a stored object, so it must not be
 * guessable from a filename, a URL or a retry of the same upload.
 */
export class FilesystemMediaStore implements MediaStore {
  constructor(
    private readonly directory: string,
    private readonly internalBaseUrl: string
  ) {}

  private paths(id: string): { body: string; meta: string } {
    return { body: join(this.directory, `${id}.bin`), meta: join(this.directory, `${id}.json`) };
  }

  async put(bytes: Uint8Array, contentType: string): Promise<StoredMedia> {
    await mkdir(this.directory, { recursive: true });
    const id = randomBytes(32).toString("hex");
    const { body, meta } = this.paths(id);
    await writeFile(body, bytes, { mode: 0o600 });
    await writeFile(meta, JSON.stringify({ contentType, bytes: bytes.byteLength }), { mode: 0o600 });
    return {
      id,
      url: `${this.internalBaseUrl.replace(/\/$/, "")}/internal/media/${id}`,
      contentType,
      bytes: bytes.byteLength
    };
  }

  async get(id: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    // The identifier is matched before it ever reaches the filesystem, so a
    // traversal attempt is rejected as a bad name rather than resolved as a path.
    if (!identifier.test(id)) return null;
    const { body, meta } = this.paths(id);
    try {
      const [bytes, descriptor] = await Promise.all([readFile(body), readFile(meta, "utf8")]);
      return {
        bytes: new Uint8Array(bytes),
        contentType: (JSON.parse(descriptor) as { contentType: string }).contentType
      };
    } catch {
      return null;
    }
  }

  async purge(before: Date): Promise<number> {
    let removed = 0;
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch {
      return 0;
    }
    for (const entry of entries) {
      const path = join(this.directory, entry);
      try {
        const info = await stat(path);
        if (info.mtime < before) {
          await rm(path, { force: true });
          removed += 1;
        }
      } catch {
        continue;
      }
    }
    return removed;
  }
}
