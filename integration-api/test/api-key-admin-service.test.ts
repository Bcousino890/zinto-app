import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createApiKey } from "../reconstructions/api-access/backend.js";

describe("reconstructed API key admin service", () => {
  it("stores only the hash and returns the secret once", async () => {
    let saved: any;
    const result = await createApiKey({
      async create(input) {
        saved = input;
        return { id: 7, companyId: input.companyId, userId: input.userId, name: input.name, keyPrefix: input.keyPrefix, permissions: input.permissions };
      }
    }, { companyId: 3, userId: 9, name: " smart bc 1 ", profile: "smartbc_crm" }, () => Buffer.from("a".repeat(32)));

    expect(result.secret).toMatch(/^pcp_/);
    expect(saved.keyHash).toBe(createHash("sha256").update(result.secret).digest("hex"));
    expect(saved.keyHash).not.toBe(result.secret);
    expect(saved.metadata).toEqual({ api_profile: "smartbc_crm" });
    expect(saved.permissions).toContain("contacts:write");
  });

  it("rejects invalid names and never reaches persistence", async () => {
    let called = false;
    await expect(createApiKey({ async create() { called = true; throw new Error("not expected"); } }, {
      companyId: 3, userId: 9, name: "\n", permissions: ["contacts:read"]
    })).rejects.toMatchObject({ code: "invalid_name" });
    expect(called).toBe(false);
  });

  it("keeps allowlisting outside the permission service", async () => {
    const result = await createApiKey({
      async create(input) {
        return { id: 8, companyId: input.companyId, userId: input.userId, name: input.name, keyPrefix: input.keyPrefix, permissions: input.permissions };
      }
    }, { companyId: 3, userId: 9, name: "pilot", permissions: ["messages:send"] });
    expect(result.record.permissions).toEqual(["messages:send"]);
    expect(result.record).not.toHaveProperty("allowlisted");
  });
});
