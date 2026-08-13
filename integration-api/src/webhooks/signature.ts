import { createHmac, timingSafeEqual } from "node:crypto";

export function signWebhook(timestamp: string, rawBody: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `v1=${digest}`;
}

export function verifyWebhookSignature(
  timestamp: string,
  rawBody: string,
  secret: string,
  signature: string
): boolean {
  const expected = Buffer.from(signWebhook(timestamp, rawBody, secret));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
