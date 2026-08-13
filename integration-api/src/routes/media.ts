import type { FastifyInstance } from "fastify";

import { ApiError } from "../http/errors.js";
import type { MediaStore } from "../media/store.js";

/**
 * Serves proxied media to the delivery engine over the internal Docker network.
 * It is unauthenticated because the engine fetches the URL without carrying the
 * partner's credentials, so the 256-bit identifier is the only capability, and
 * the prefix is denied at the public reverse proxy.
 */
export function registerMediaRoutes(app: FastifyInstance, store: MediaStore): void {
  app.get<{ Params: { id: string } }>("/internal/media/:id", async (request, reply) => {
    const media = await store.get(request.params.id);
    if (media === null) throw new ApiError(404, "media_not_found", "The media was not found");
    return reply
      .header("content-type", media.contentType)
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .send(Buffer.from(media.bytes));
  });
}
