import { listPermissionDefinitions, listProfiles } from "../../api-access-module/catalog.js";
import { PermissionValidationError } from "../../api-access-module/errors.js";
import type { ApiKeyRecord, ApiKeyStore, CreateApiKeyInput } from "./backend.js";
import { ApiKeyAdminError, createApiKey } from "./backend.js";

export interface AdminRequest {
  body: unknown;
  session?: { userId: number; companyId: number; isAdmin: boolean };
}

export interface AdminResponse {
  status(code: number): AdminResponse;
  json(payload: unknown): void;
}

export interface AdminContext {
  store: ApiKeyStore;
  random?: (size: number) => Buffer;
}

export function apiKeyCatalog() {
  return {
    version: 1,
    scopes: listPermissionDefinitions().map(({ name, group, label, description, dangerous }) => ({
      id: name, group, label, description, dangerous
    })),
    profiles: listProfiles().map(({ name, label, description, permissions }) => ({
      id: name, label, description, permissions
    }))
  };
}

function requireAdmin(request: AdminRequest): NonNullable<AdminRequest["session"]> {
  if (!request.session?.isAdmin) throw new Error("admin_required");
  return request.session;
}

function toCreateInput(request: AdminRequest, body: unknown): CreateApiKeyInput {
  const session = requireAdmin(request);
  if (!body || typeof body !== "object") throw new PermissionValidationError("invalid_body", "request body must be an object");
  const input = body as Record<string, unknown>;
  if (typeof input.name !== "string") throw new PermissionValidationError("invalid_name", "name must be a string");
  if (input.profile !== undefined && typeof input.profile !== "string") {
    throw new PermissionValidationError("invalid_profile", "profile must be a string");
  }
  if (input.permissions !== undefined && (!Array.isArray(input.permissions) || input.permissions.some((value) => typeof value !== "string"))) {
    throw new PermissionValidationError("invalid_permissions", "permissions must be an array of strings");
  }
  return {
    companyId: session.companyId,
    userId: session.userId,
    name: input.name,
    profile: input.profile as string | undefined,
    permissions: input.permissions as string[] | undefined
  };
}

export async function getApiKeyCatalog(_request: AdminRequest, response: AdminResponse): Promise<void> {
  response.status(200).json({ data: apiKeyCatalog() });
}

export async function postApiKey(request: AdminRequest, response: AdminResponse, context: AdminContext): Promise<void> {
  try {
    const result = await createApiKey(context.store, toCreateInput(request, request.body), context.random);
    response.status(201).json({
      data: { ...result.record, key: result.secret }
    });
  } catch (error) {
    if (error instanceof PermissionValidationError || error instanceof ApiKeyAdminError) {
      response.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof Error && error.message === "admin_required") {
      response.status(403).json({ error: { code: "forbidden", message: "administrator access required" } });
      return;
    }
    throw error;
  }
}

export type { ApiKeyRecord };
