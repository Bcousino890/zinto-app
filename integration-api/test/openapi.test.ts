import { readFile } from "node:fs/promises";

import SwaggerParser from "@apidevtools/swagger-parser";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const contractPath = new URL("../openapi/openapi.yaml", import.meta.url);

describe("OpenAPI partner contract", () => {
  it("is a valid OpenAPI 3.1 document", async () => {
    const document = parse(await readFile(contractPath, "utf8"));
    await expect(SwaggerParser.validate(document)).resolves.toBeDefined();
    expect(document.openapi).toMatch(/^3\.1\./);
  });

  it("documents every implemented public operation", async () => {
    const document = parse(await readFile(contractPath, "utf8"));
    const operations = Object.entries(document.paths as Record<string, Record<string, unknown>>)
      .flatMap(([path, methods]) => Object.keys(methods)
        .filter((method) => ["get", "post", "patch", "put", "delete"].includes(method))
        .map((method) => `${method.toUpperCase()} ${path}`))
      .sort();

    expect(operations).toEqual([
      "DELETE /api/v1/contacts/{id}",
      "DELETE /api/v1/contacts/{id}/tags/{tag}",
      "DELETE /api/v1/notes/{id}",
      "DELETE /api/v1/webhooks/{id}",
      "GET /api/v1/channels",
      "GET /api/v1/contacts",
      "GET /api/v1/conversations",
      "GET /api/v1/conversations/{id}/messages",
      "GET /api/v1/me",
      "GET /api/v1/webhooks",
      "GET /health",
      "PATCH /api/v1/contacts/{id}",
      "PATCH /api/v1/notes/{id}",
      "POST /api/v1/contacts",
      "POST /api/v1/contacts/{id}/notes",
      "POST /api/v1/messages/send",
      "POST /api/v1/messages/send-interactive",
      "POST /api/v1/messages/send-media",
      "POST /api/v1/messages/send-template",
      "POST /api/v1/webhooks",
      "PUT /api/v1/contacts/{id}/tags/{tag}"
    ]);
  });

  it("defines security, idempotency, pagination, webhooks, and canonical errors", async () => {
    const document = parse(await readFile(contractPath, "utf8"));
    expect(document.components.securitySchemes.bearerAuth).toEqual(expect.objectContaining({
      type: "http",
      scheme: "bearer"
    }));
    expect(document.components.parameters.IdempotencyKey).toBeDefined();
    expect(document.components.parameters.Cursor).toBeDefined();
    expect(document.components.schemas.WebhookEvent).toBeDefined();
    expect(document.components.schemas.ErrorResponse).toBeDefined();
  });
});
