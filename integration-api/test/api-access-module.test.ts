import { describe, expect, it } from "vitest";

import {
  PermissionValidationError,
  listPermissionDefinitions,
  listProfiles,
  normalizePermissions,
  resolvePermissionSelection
} from "../api-access-module/index.js";

describe("API access permission catalog", () => {
  it("publishes unique permissions with grouped metadata", () => {
    const definitions = listPermissionDefinitions();
    const names = definitions.map(({ name }) => name);

    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    expect(definitions.every(({ group, label, description }) => group && label && description)).toBe(true);
    expect(definitions.find(({ name }) => name === "contacts:write")?.dangerous).toBe(true);
  });

  it("exposes stable profiles and sorted effective permissions", () => {
    const profiles = listProfiles();
    expect(profiles.map(({ name }) => name)).toEqual([
      "messaging", "crm_read_only", "smartbc_crm", "full_crm"
    ]);
    for (const profile of profiles) {
      expect(profile.permissions).toEqual([...profile.permissions].sort((left, right) => left.localeCompare(right)));
    }
  });
});
describe("API access permission validation", () => {
  it("trims, deduplicates, and sorts explicit permissions", () => {
    expect(normalizePermissions([" messages:send ", "contacts:read", "messages:send"])).toEqual([
      "contacts:read", "messages:send"
    ]);
  });

  it("resolves a profile to its effective permissions", () => {
    const result = resolvePermissionSelection({ profile: "smartbc_crm" });

    expect(result.source).toBe("profile");
    expect(result.profile).toBe("smartbc_crm");
    expect(result.permissions).toContain("contacts:write");
    expect(result.permissions).toContain("tasks:write");
  });

  it("resolves explicit permissions without silently adding profile permissions", () => {
    const result = resolvePermissionSelection({ permissions: ["messages:send"] });

    expect(result.source).toBe("permissions");
    expect(result.profile).toBeUndefined();
    expect(result.permissions).toEqual(["messages:send"]);
  });

  it.each([
    ["missing selection", {}, "missing_selection"],
    ["both selection modes", { profile: "messaging", permissions: ["messages:send"] }, "ambiguous_selection"],
    ["unknown permission", { permissions: ["contacts:admin"] }, "unknown_permission"],
    ["unknown profile", { profile: "partner_admin" }, "unknown_profile"],
    ["empty permissions", { permissions: [] }, "invalid_permissions"]
  ])("rejects %s", (_label, selection, code) => {
    expect(() => resolvePermissionSelection(selection)).toThrowError(PermissionValidationError);
    try {
      resolvePermissionSelection(selection);
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionValidationError);
      expect((error as PermissionValidationError).code).toBe(code);
    }
  });
});
