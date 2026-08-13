import { assertSafeDestination, type HostResolver } from "../net/destination.js";
import { ApiError } from "../http/errors.js";

/**
 * The media URL is handed to the legacy engine, which performs the actual
 * download. We can therefore only gate the destination, not pin the socket the
 * engine opens; that residual rebinding risk is recorded in the SSRF notes.
 */
export async function assertSafeMediaUrl(value: string, resolve?: HostResolver): Promise<void> {
  try {
    await assertSafeDestination(value, { protocols: ["http:", "https:"], resolve });
  } catch {
    throw new ApiError(400, "unsafe_media_url", "The media URL is not safe");
  }
}
