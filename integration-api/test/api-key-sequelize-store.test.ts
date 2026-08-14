import { describe, expect, it } from "vitest";

import { createSequelizeApiKeyStore } from "../reconstructions/api-access/sequelize-store.js";

describe("reconstructed Sequelize API key store", () => {
  it("maps the existing api_keys fields without persisting the plaintext key", async () => {
    let values: Record<string, unknown> | undefined;
    const store = createSequelizeApiKeyStore({
      async create(input) {
        values = input;
        return { id: 4, companyId: input.companyId, userId: input.userId, name: input.name, keyPrefix: input.keyPrefix, permissions: input.permissions };
      }
    });
    const record = await store.create({ companyId: 3, userId: 9, name: "pilot", keyHash: "hash", keyPrefix: "pcp_abc", permissions: ["messages:send"], metadata: {} });
    expect(values).not.toHaveProperty("key");
    expect(values).toMatchObject({ keyHash: "hash", keyPrefix: "pcp_abc", isActive: true });
    expect(record).toMatchObject({ id: 4, companyId: 3, userId: 9, name: "pilot" });
  });
});
