/**
 * This API only ever accepts JSON: media travels by reference as a URL the
 * legacy engine fetches, never as an upload, so Fastify's own 1 MiB default
 * is far looser than anything a legitimate request needs. The global limit
 * stays generous enough for the largest validated field we accept (a 20,000
 * character contact note, which is up to 80 KB in worst-case UTF-8) plus the
 * unbounded `custom_fields`/`components` records some schemas allow. Routes
 * whose validated field lengths bound the payload well below that get a
 * tighter, route-specific override.
 */
export const globalBodyLimitBytes = 131_072; // 128 KiB

// Delivery routes: the largest single field is a 4096-character message,
// worst case 16 KB in UTF-8; 32 KiB leaves headroom for the other fields and
// JSON overhead while still bounding the unvalidated `components`/`action`
// payloads well below the global default.
export const messageBodyLimitBytes = 32_768; // 32 KiB

// Webhook registration: a URL (max 2048 chars) and an event-type list.
export const webhookBodyLimitBytes = 8_192; // 8 KiB
