import { getProfile, isPermission, isProfile } from "./catalog.js";
import { PermissionValidationError } from "./errors.js";
import type { ApiKeyProfile, ApiPermission, PermissionSelection, ResolvedPermissionSelection } from "./types.js";

function sortedUnique(values: readonly ApiPermission[]): ApiPermission[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function normalizePermissions(input: readonly string[]): ApiPermission[] {
  if (!Array.isArray(input) || input.length === 0 || input.some((value) => typeof value !== "string" || value.trim() === "")) {
    throw new PermissionValidationError("invalid_permissions", "permissions must be a non-empty array of strings");
  }

  const normalized = input.map((permission) => permission.trim());
  const unknown = [...new Set(normalized.filter((permission) => !isPermission(permission)))].sort();
  if (unknown.length > 0) {
    throw new PermissionValidationError(
      "unknown_permission",
      "permissions contains unknown values",
      unknown
    );
  }

  return sortedUnique(normalized as ApiPermission[]);
}

export function resolvePermissionSelection(selection: PermissionSelection): ResolvedPermissionSelection {
  const hasPermissions = selection.permissions !== undefined;
  const hasProfile = selection.profile !== undefined;

  if (hasPermissions === hasProfile) {
    throw new PermissionValidationError(
      hasPermissions ? "ambiguous_selection" : "missing_selection",
      hasPermissions
        ? "Provide either permissions or profile, not both"
        : "Provide permissions or profile"
    );
  }

  if (hasPermissions) {
    return { source: "permissions", permissions: normalizePermissions(selection.permissions ?? []) };
  }

  const profile = selection.profile?.trim() ?? "";
  if (!isProfile(profile)) {
    throw new PermissionValidationError("unknown_profile", "profile is not supported", [profile]);
  }

  const definition = getProfile(profile);
  if (!definition) {
    throw new PermissionValidationError("unknown_profile", "profile is not supported", [profile]);
  }

  return {
    source: "profile",
    profile: profile as ApiKeyProfile,
    permissions: sortedUnique([...definition.permissions])
  };
}

