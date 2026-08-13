import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { ApiError } from "../src/http/errors.js";
import { fetchRemoteMedia, type MediaKind } from "../src/media/fetch.js";
import { DownloadingMediaProxy, type MediaSizeLimits } from "../src/media/proxy.js";
import { FilesystemMediaStore } from "../src/media/store.js";

const policy = {
  maxBytes: 1024,
  timeoutMs: 5000
};

function respondWith(body: string | Uint8Array, contentType: string, status = 200): () => Promise<Response> {
  // Copied through the ArrayLike overload so the buffer type matches BodyInit.
  const bytes = new Uint8Array(typeof body === "string" ? new TextEncoder().encode(body) : body);
  return async () => new Response(bytes, { status, headers: { "content-type": contentType } });
}

describe("remote media download", () => {
  it("returns the bytes and content type of an allowed image", async () => {
    const media = await fetchRemoteMedia("https://cdn.partner.example/a.png", "image", {
      ...policy,
      fetch: respondWith(new Uint8Array([1, 2, 3, 4]), "image/png")
    });

    expect(media.contentType).toBe("image/png");
    expect(Array.from(media.bytes)).toEqual([1, 2, 3, 4]);
  });

  it("rejects a content type that contradicts the declared media type", async () => {
    await expect(fetchRemoteMedia("https://cdn.partner.example/a.png", "image", {
      ...policy,
      fetch: respondWith("<html>not an image</html>", "text/html")
    })).rejects.toMatchObject({ code: "media_type_mismatch" });
  });

  it("rejects a payload larger than the configured limit", async () => {
    await expect(fetchRemoteMedia("https://cdn.partner.example/big.png", "image", {
      ...policy,
      fetch: respondWith(new Uint8Array(policy.maxBytes + 1), "image/png")
    })).rejects.toMatchObject({ code: "media_too_large" });
  });

  it("rejects a payload whose declared length already exceeds the limit", async () => {
    await expect(fetchRemoteMedia("https://cdn.partner.example/big.png", "image", {
      ...policy,
      fetch: async () => new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(policy.maxBytes + 1) }
      })
    })).rejects.toMatchObject({ code: "media_too_large" });
  });

  it("rejects a non-2xx response from the origin", async () => {
    await expect(fetchRemoteMedia("https://cdn.partner.example/a.png", "image", {
      ...policy,
      fetch: respondWith("nope", "text/plain", 404)
    })).rejects.toMatchObject({ code: "media_unreachable" });
  });

  it("reports an unsafe destination as unsafe, not as unreachable", async () => {
    await expect(fetchRemoteMedia("https://cdn.partner.example/a.png", "image", {
      ...policy,
      fetch: async () => { throw new (await import("../src/net/destination.js")).UnsafeDestinationError(); }
    })).rejects.toMatchObject({ code: "unsafe_media_url" });
  });

  it("accepts the content types each media kind is allowed to carry", async () => {
    const cases: [Parameters<typeof fetchRemoteMedia>[1], string][] = [
      ["image", "image/jpeg"],
      ["video", "video/mp4"],
      ["audio", "audio/ogg"],
      ["document", "application/pdf"]
    ];
    for (const [kind, contentType] of cases) {
      const media = await fetchRemoteMedia("https://cdn.partner.example/f", kind, {
        ...policy,
        fetch: respondWith(new Uint8Array([9]), contentType)
      });
      expect(media.contentType).toBe(contentType);
    }
  });

  it("refuses a document that claims to be a script", async () => {
    await expect(fetchRemoteMedia("https://cdn.partner.example/x", "document", {
      ...policy,
      fetch: respondWith("alert(1)", "text/html")
    })).rejects.toMatchObject({ code: "media_type_mismatch" });
  });

  it("refuses an SVG claiming to be an image, because it can carry an embedded script", async () => {
    await expect(fetchRemoteMedia("https://cdn.partner.example/x.svg", "image", {
      ...policy,
      fetch: respondWith("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>", "image/svg+xml")
    })).rejects.toMatchObject({ code: "media_type_mismatch" });
  });
});

describe("controlled media storage", () => {
  async function makeStore() {
    const directory = await mkdtemp(join(tmpdir(), "zinto-media-"));
    return {
      directory,
      store: new FilesystemMediaStore(directory, "http://zinto-integration-api:3100")
    };
  }

  it("stores bytes under an unguessable identifier and serves them back", async () => {
    const { store } = await makeStore();
    const stored = await store.put(new Uint8Array([7, 8, 9]), "image/png");

    expect(stored.id).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.url).toBe(`http://zinto-integration-api:3100/internal/media/${stored.id}`);

    const loaded = await store.get(stored.id);
    expect(loaded?.contentType).toBe("image/png");
    expect(Array.from(loaded!.bytes)).toEqual([7, 8, 9]);
  });

  it("never derives the stored name from partner input", async () => {
    const { store } = await makeStore();
    const first = await store.put(new Uint8Array([1]), "image/png");
    const second = await store.put(new Uint8Array([1]), "image/png");

    expect(first.id).not.toBe(second.id);
  });

  it("refuses an identifier that could escape the storage directory", async () => {
    const { store } = await makeStore();
    for (const id of ["../../etc/passwd", "..", "a/b", "ZZZZ", ""]) {
      expect(await store.get(id)).toBeNull();
    }
  });

  it("returns null for an identifier that was never stored", async () => {
    const { store } = await makeStore();
    expect(await store.get("a".repeat(64))).toBeNull();
  });

  it("removes entries older than the retention window", async () => {
    const { store, directory } = await makeStore();
    const stored = await store.put(new Uint8Array([1]), "image/png");

    await store.purge(new Date(Date.now() + 3_600_000));

    expect(await store.get(stored.id)).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });

  it("keeps entries inside the retention window", async () => {
    const { store } = await makeStore();
    const stored = await store.put(new Uint8Array([1]), "image/png");

    await store.purge(new Date(Date.now() - 3_600_000));

    expect(await store.get(stored.id)).not.toBeNull();
  });
});

describe("the engine never receives the partner URL", () => {
  it("hands delivery an internal URL and serves the bytes back", async () => {
    const { buildApp } = await import("../src/app.js");
    const { createHash } = await import("node:crypto");
    const { DownloadingMediaProxy } = await import("../src/media/proxy.js");

    const rawKey = `pcp_${"b".repeat(64)}`;
    const keyHash = createHash("sha256").update(rawKey.slice(4)).digest("hex");
    const directory = await mkdtemp(join(tmpdir(), "zinto-media-route-"));
    const store = new FilesystemMediaStore(directory, "http://zinto-integration-api:3100");
    const delivered: string[] = [];

    const app = await buildApp({
      apiKeyRepository: {
        async findByHash(hash: string) {
          return hash === keyHash
            ? {
                id: 41, companyId: 42, companyName: "Empresa", userId: 4, name: "Partner",
                keyHash, permissions: ["*"], isActive: true, expiresAt: null, allowedIps: []
              }
            : null;
        },
        async markUsed() {}
      },
      coreRepository: {
        async listChannels() {
          return [{ id: "5", type: "whatsapp", name: "WhatsApp", status: "connected", capabilities: ["text", "media"] }];
        },
        async listContacts() { return { items: [], hasMore: false, nextCursor: null }; },
        async listConversations() { return { items: [], hasMore: false, nextCursor: null }; },
        async listMessages() { return null; }
      },
      deliveryClient: {
        async deliver(request: { kind: string; mediaUrl?: string }) {
          if (request.mediaUrl !== undefined) delivered.push(request.mediaUrl);
          return {
            id: "1", external_id: null, status: "sent",
            timestamp: "2026-08-13T12:00:00.000Z", channel_type: "whatsapp", conversation_id: "9"
          };
        }
      },
      hostResolver: async () => ["93.184.216.34"],
      idempotencyRepository: {
        async find() { return null; },
        async save() {},
        async runExclusive<T>(_scope: unknown, operation: () => Promise<T>) { return operation(); }
      },
      logger: false,
      mediaProxy: new DownloadingMediaProxy(store, {
        timeoutMs: 5000,
        fetch: async () => new Response(new Uint8Array([5, 6, 7]), {
          status: 200,
          headers: { "content-type": "image/png" }
        })
      }, { image: 4096, video: 4096, audio: 4096, document: 4096 }),
      mediaStore: store,
      readOnly: false
    } as never);

    const send = await app.inject({
      method: "POST",
      url: "/api/v1/messages/send-media",
      headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": "media-proxy-1" },
      payload: {
        channel_id: "5", to: "+56911112222",
        media_type: "image", media_url: "https://cdn.partner.example/a.png"
      }
    });

    expect(send.statusCode).toBe(201);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatch(/^http:\/\/zinto-integration-api:3100\/internal\/media\/[a-f0-9]{64}$/);
    expect(delivered[0]).not.toContain("partner.example");

    const id = delivered[0]!.split("/").at(-1)!;
    const served = await app.inject({ method: "GET", url: `/internal/media/${id}` });
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");
    expect(Array.from(served.rawPayload)).toEqual([5, 6, 7]);

    const missing = await app.inject({ method: "GET", url: `/internal/media/${"c".repeat(64)}` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("media_not_found");

    await app.close();
  });
});

describe("media errors are canonical", () => {
  it("uses ApiError so the public contract stays stable", async () => {
    const error = await fetchRemoteMedia("https://cdn.partner.example/a.png", "image", {
      ...policy,
      fetch: respondWith("<html>", "text/html")
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(400);
  });
});

const requiredMediaConfig = {
  DATABASE_URL: "postgres://zinto:test@db:5432/zinto",
  LEGACY_API_URL: "http://legacy:9000",
  WEBHOOK_ENCRYPTION_KEY: "a".repeat(64)
};

function defaultMaxBytesByKind(): MediaSizeLimits {
  const config = loadConfig(requiredMediaConfig);
  return {
    image: config.MEDIA_MAX_BYTES_IMAGE,
    video: config.MEDIA_MAX_BYTES_VIDEO,
    audio: config.MEDIA_MAX_BYTES_AUDIO,
    document: config.MEDIA_MAX_BYTES_DOCUMENT
  };
}

async function makeLimitsStore(): Promise<FilesystemMediaStore> {
  const directory = await mkdtemp(join(tmpdir(), "zinto-media-limits-"));
  return new FilesystemMediaStore(directory, "http://zinto-integration-api:3100");
}

function respondWithBytes(byteLength: number, contentType: string): () => Promise<Response> {
  return async () => new Response(new Uint8Array(byteLength), { status: 200, headers: { "content-type": contentType } });
}

const storedMediaUrl = /^http:\/\/zinto-integration-api:3100\/internal\/media\/[a-f0-9]{64}$/;

describe("media size limits are applied per media type", () => {
  it("defaults to the real WhatsApp Business API limits: image 5 MB, video/audio 16 MB, document 100 MB", () => {
    const limits = defaultMaxBytesByKind();

    expect(limits.image).toBe(5_242_880);
    expect(limits.video).toBe(16_777_216);
    expect(limits.audio).toBe(16_777_216);
    expect(limits.document).toBe(104_857_600);
  });

  it("rejects a 6 MB image but accepts the identical 6 MB payload sent as a document", async () => {
    const store = await makeLimitsStore();
    const sixMb = 6 * 1024 * 1024;
    const maxBytesByKind = defaultMaxBytesByKind();

    const imageProxy = new DownloadingMediaProxy(store, {
      timeoutMs: 5000,
      fetch: respondWithBytes(sixMb, "image/jpeg")
    }, maxBytesByKind);
    await expect(imageProxy.prepare("https://cdn.partner.example/a.jpg", "image"))
      .rejects.toMatchObject({ code: "media_too_large" });

    const documentProxy = new DownloadingMediaProxy(store, {
      timeoutMs: 5000,
      fetch: respondWithBytes(sixMb, "application/pdf")
    }, maxBytesByKind);
    await expect(documentProxy.prepare("https://cdn.partner.example/a.pdf", "document"))
      .resolves.toMatch(storedMediaUrl);
  });

  it("accepts a 90 MB document, which is under the 100 MB document default", async () => {
    const store = await makeLimitsStore();
    const proxy = new DownloadingMediaProxy(store, {
      timeoutMs: 5000,
      fetch: respondWithBytes(90 * 1024 * 1024, "application/pdf")
    }, defaultMaxBytesByKind());

    await expect(proxy.prepare("https://cdn.partner.example/big.pdf", "document")).resolves.toMatch(storedMediaUrl);
  });

  it("rejects a video over its own 16 MB default, well under what the document cap would allow", async () => {
    const store = await makeLimitsStore();
    const proxy = new DownloadingMediaProxy(store, {
      timeoutMs: 5000,
      fetch: respondWithBytes(17 * 1024 * 1024, "video/mp4")
    }, defaultMaxBytesByKind());

    await expect(proxy.prepare("https://cdn.partner.example/clip.mp4", "video"))
      .rejects.toMatchObject({ code: "media_too_large" });
  });

  it("keeps the declared content-length check working, selecting the limit for the type in the same request", async () => {
    const store = await makeLimitsStore();
    const limits = defaultMaxBytesByKind();
    // One byte over the image limit, but still comfortably under the document limit.
    const declaredLength = limits.image + 1;

    const imageProxy = new DownloadingMediaProxy(store, {
      timeoutMs: 5000,
      fetch: async () => new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(declaredLength) }
      })
    }, limits);
    await expect(imageProxy.prepare("https://cdn.partner.example/f.png", "image"))
      .rejects.toMatchObject({ code: "media_too_large" });

    const documentProxy = new DownloadingMediaProxy(store, {
      timeoutMs: 5000,
      fetch: async () => new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "application/pdf", "content-length": String(declaredLength) }
      })
    }, limits);
    await expect(documentProxy.prepare("https://cdn.partner.example/f.pdf", "document")).resolves.toMatch(storedMediaUrl);
  });

  it("still rejects on real received bytes over the per-type limit when no content-length is declared", async () => {
    const store = await makeLimitsStore();
    const limits = defaultMaxBytesByKind();
    const proxy = new DownloadingMediaProxy(store, {
      timeoutMs: 5000,
      fetch: respondWithBytes(limits.audio + 1, "audio/mpeg")
    }, limits);

    await expect(proxy.prepare("https://cdn.partner.example/clip.mp3", "audio"))
      .rejects.toMatchObject({ code: "media_too_large" });
  });
});
