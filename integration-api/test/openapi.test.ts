import { readFile } from "node:fs/promises";

import SwaggerParser from "@apidevtools/swagger-parser";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { buildApp } from "../src/app.js";

const contractPath = new URL("../openapi/openapi.yaml", import.meta.url);

/** Routes the contract deliberately omits: reached only over the internal network. */
const unpublished = ["GET /internal/media/{id}"];

/**
 * Fastify prints a radix tree, so a child line carries only the suffix its
 * parent did not already spell out. Prefixes are accumulated by depth to
 * recover the real paths instead of trusting the visible text of each line.
 */
function routesOf(tree: string): string[] {
  const prefixes: string[] = [];
  const routes: string[] = [];
  for (const line of tree.split("\n")) {
    const marker = Math.max(line.indexOf("├── "), line.indexOf("└── "));
    if (marker === -1) continue;
    const depth = marker / 4;
    const body = line.slice(marker + 4);
    const methods = /\(([^)]*)\)\s*$/.exec(body);
    const segment = methods === null ? body : body.slice(0, methods.index).trimEnd();
    prefixes[depth] = (depth === 0 ? "" : prefixes[depth - 1] ?? "") + segment;
    if (methods === null) continue;
    const path = prefixes[depth]!.replace(/:(\w+)/g, "{$1}");
    for (const method of methods[1]!.split(",").map((value) => value.trim())) {
      if (method !== "HEAD") routes.push(`${method} ${path}`);
    }
  }
  return routes;
}

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
      "GET /api/v1/deals",
      "GET /api/v1/deals/{id}",
      "GET /api/v1/me",
      "GET /api/v1/messages/{id}",
      "GET /api/v1/pipelines",
      "GET /api/v1/pipelines/{id}/stages",
      "GET /api/v1/tasks",
      "GET /api/v1/webhooks",
      "GET /health",
      "GET /ready",
      "PATCH /api/v1/contacts/{id}",
      "PATCH /api/v1/deals/{id}/stage",
      "PATCH /api/v1/notes/{id}",
      "POST /api/v1/contacts",
      "POST /api/v1/contacts/{id}/notes",
      "POST /api/v1/conversations",
      "POST /api/v1/messages/send",
      "POST /api/v1/messages/send-interactive",
      "POST /api/v1/messages/send-media",
      "POST /api/v1/messages/send-template",
      "POST /api/v1/webhooks",
      "PUT /api/v1/contacts/{id}/tags/{tag}"
    ]);
  });

  it("documents every route the service actually registers", async () => {
    const document = parse(await readFile(contractPath, "utf8"));
    const documented = new Set(
      Object.entries(document.paths as Record<string, Record<string, unknown>>)
        .flatMap(([path, methods]) => Object.keys(methods)
          .filter((method) => ["get", "post", "patch", "put", "delete"].includes(method))
          .map((method) => `${method.toUpperCase()} ${path}`))
    );

    const stub = new Proxy({}, { get: () => async () => null });
    const app = await buildApp({
      apiKeyRepository: stub, contactMutationRepository: stub,
      conversationMutationRepository: stub, coreRepository: stub,
      deliveryClient: stub, idempotencyRepository: stub, logger: false,
      mediaStore: stub, pipelineMutationRepository: stub, pipelineRepository: stub,
      webhookRepository: stub
    } as never);
    const registered = routesOf(app.printRoutes({ commonPrefix: false }));
    await app.close();

    expect(registered.length).toBeGreaterThan(20);
    expect(registered.filter((route) => !documented.has(route)).sort())
      .toEqual(unpublished);
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
