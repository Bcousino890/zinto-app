import { describe, expect, it } from "vitest";

import { CATALOG, PROFILES } from "../api-access-module/frontend/catalog.js";
import { buildCreateRequest, normalizePermissions, permissionsForProfile } from "../api-access-module/frontend/permission-model.js";

describe("API Access permission module", () => {
  it("keeps the catalog unique and profiles within the catalog", () => {
    const ids = CATALOG.permissions.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const profile of PROFILES) {
      expect(profile.permissions.every((item) => ids.includes(item))).toBe(true);
    }
  });

  it("normalizes, deduplicates and sorts custom permissions", () => {
    expect(normalizePermissions(["messages:send", "contacts:read", "messages:send", "unknown"])).toEqual([
      "contacts:read",
      "messages:send"
    ]);
  });

  it("builds a profile request without leaking the expanded permission list", () => {
    expect(buildCreateRequest("  SmartBC  ", { profile: "smartbc_crm", permissions: [] })).toEqual({
      name: "SmartBC",
      profile: "smartbc_crm"
    });
    expect(permissionsForProfile("messaging")).toContain("messages:send");
  });

  it("requires a name and at least one custom permission", () => {
    expect(() => buildCreateRequest(" ", { permissions: ["contacts:read"] })).toThrow("nombre");
    expect(() => buildCreateRequest("Clave", { permissions: [] })).toThrow("permiso");
  });
});
