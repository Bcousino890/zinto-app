import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { DeliveryAdapterError } from "../src/delivery/client.js";
import { secureLoggerOptions } from "../src/http/logging.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("DeliveryAdapterError", () => {
  it("does not expose the raw legacy response through plain object enumeration", () => {
    const marker = "customer-phone-should-not-leak-+34600000000";
    const error = new DeliveryAdapterError(502, { data: { to: marker, secret: "should-not-leak-either" } });

    expect(Object.keys(error)).not.toContain("response");
    expect(JSON.stringify(error)).not.toContain(marker);
    // The data is still reachable for legitimate direct access, just not via
    // a generic for...in / spread copy such as pino's default `err` serializer.
    expect(error.response).toEqual({ data: { to: marker, secret: "should-not-leak-either" } });
  });

  it("keeps the raw legacy response out of a log line if it ever reaches a generic error log", async () => {
    const chunks: string[] = [];
    const stream = { write(chunk: string) { chunks.push(chunk); } };
    const app = await buildApp({ logger: { ...secureLoggerOptions("info"), stream } });
    apps.push(app);

    const marker = "customer-message-should-not-leak-hola-cliente";
    const error = new DeliveryAdapterError(502, { data: { message: marker } });
    app.log.error({ err: error }, "legacy delivery adapter error reached the generic handler");

    expect(chunks.join("")).not.toContain(marker);
  });
});
