import { CATALOG, PROFILES } from "./catalog.js";
import type { ApiKeyCreateRequest, PermissionId, PermissionProfileId } from "./types.js";

const knownPermissions = new Set<PermissionId>(CATALOG.permissions.map((item) => item.id));

export function normalizePermissions(permissions: readonly string[]): PermissionId[] {
  return [...new Set(permissions)].filter((permission): permission is PermissionId =>
    knownPermissions.has(permission as PermissionId)
  ).sort();
}

export function permissionsForProfile(profile: PermissionProfileId): PermissionId[] {
  const definition = PROFILES.find((item) => item.id === profile);
  if (!definition) throw new Error(`Perfil desconocido: ${profile}`);
  return normalizePermissions(definition.permissions);
}

export function buildCreateRequest(
  name: string,
  selection: { profile?: PermissionProfileId; permissions: readonly string[] }
): ApiKeyCreateRequest {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("El nombre de la clave es obligatorio");

  if (selection.profile) {
    return { name: trimmedName, profile: selection.profile };
  }

  const permissions = normalizePermissions(selection.permissions);
  if (permissions.length === 0) throw new Error("Selecciona al menos un permiso");
  return { name: trimmedName, permissions };
}

export function permissionGroups() {
  return [...new Set(CATALOG.permissions.map((item) => item.group))];
}
