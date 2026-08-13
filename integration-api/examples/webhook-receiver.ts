import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const secret = process.env.ZINTO_WEBHOOK_SECRET;
if (!secret) throw new Error("ZINTO_WEBHOOK_SECRET is required");

const processed = new Set<string>();
const toleranceSeconds = 5 * 60;

function validSignature(timestamp: string, body: string, received: string): boolean {
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const expected = Buffer.from(`v1=${digest}`);
  const actual = Buffer.from(received);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const timestamp = String(request.headers["x-zinto-timestamp"] ?? "");
    const signature = String(request.headers["x-zinto-signature"] ?? "");
    const eventId = String(request.headers["x-zinto-event-id"] ?? "");

    if (!validSignature(timestamp, body, signature)) {
      response.writeHead(401).end("invalid signature");
      return;
    }
    if (!processed.has(eventId)) {
      processed.add(eventId);
      const event = JSON.parse(body) as { type: string; data: unknown };
      console.log("Zinto event", event.type, event.data);
    }
    response.writeHead(204).end();
  });
}).listen(3000, "127.0.0.1", () => {
  console.log("Webhook receiver listening on http://127.0.0.1:3000");
});

