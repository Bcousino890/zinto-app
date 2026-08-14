import { describe, expect, it } from "vitest";

import { getApiKeyCatalog, postApiKey } from "../reconstructions/api-access/http-adapter.js";

function response() {
  const result: { code?: number; body?: unknown } = {};
  return { result, value: { status(code: number) { result.code = code; return this; }, json(body: unknown) { result.body = body; } } };
}

const store = { async create(input: any) {
  return { id: 12, companyId: input.companyId, userId: input.userId, name: input.name, keyPrefix: input.keyPrefix, permissions: input.permissions };
} };

describe("API Access HTTP adapter", () => {
  it("publishes catalog and profiles without secrets", async () => {
    const out = response();
    await getApiKeyCatalog({ body: {} }, out.value);
    expect(out.result.code).toBe(200);
    expect(out.result.body).toMatchObject({ data: { version: 1 } });
  });

  it("creates a profile-based key for the authenticated company", async () => {
    const out = response();
    await postApiKey({ body: { name: "smart bc 1", profile: "smartbc_crm" }, session: { userId: 9, companyId: 3, isAdmin: true } }, out.value, { store, random: () => Buffer.from("b".repeat(32)) });
    expect(out.result.code).toBe(201);
    expect(out.result.body).toMatchObject({ data: { name: "smart bc 1", key: expect.stringMatching(/^pcp_/) } });
  });

  it("does not allow a normal user to create keys", async () => {
    const out = response();
    await postApiKey({ body: { name: "nope", profile: "messaging" }, session: { userId: 9, companyId: 3, isAdmin: false } }, out.value, { store });
    expect(out.result.code).toBe(403);
  });
});
