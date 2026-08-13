import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("service health contract", () => {
  it("returns a request-correlated health response without secrets", async () => {
    const app = await buildApp({ logger: false });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toMatch(/^req_[a-f0-9-]+$/);
    expect(response.json()).toEqual({
      data: {
        service: "zinto-integration-api",
        status: "ok",
        version: "0.1.0"
      },
      meta: {
        request_id: response.headers["x-request-id"]
      }
    });
    expect(response.body).not.toContain("DATABASE_URL");
  });

  it("returns the canonical error envelope for an unknown route", async () => {
    const app = await buildApp({ logger: false });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/missing" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "not_found",
        message: "Route not found",
        request_id: response.headers["x-request-id"]
      }
    });
  });

  it("closes owned dependencies when the application stops", async () => {
    let closed = false;
    const app = await buildApp({
      logger: false,
      onClose: async () => {
        closed = true;
      }
    });

    await app.close();

    expect(closed).toBe(true);
  });
});
