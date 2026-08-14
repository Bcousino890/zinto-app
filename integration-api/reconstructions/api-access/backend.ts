import { createHash, randomBytes } from "node:crypto";

import { resolvePermissionSelection } from "../../api-access-module/validation.js";
import type { ApiKeyProfile, ApiPermission, PermissionSelection } from "../../api-access-module/types.js";

export interface ApiKeyRecordInput {
  companyId: number;
  userId: number;
  name: string;
  keyHash: string;
  keyPrefix: string;
  permissions: readonly ApiPermission[];
  metadata: Record<string, unknown>;
}

export interface ApiKeyRecord {
  id: number;
  companyId: number;
  userId: number;
  name: string;
  keyPrefix: string;
  permissions: readonly ApiPermission[];
  profile?: ApiKeyProfile;
}

export interface ApiKeyStore {
  create(input: ApiKeyRecordInput): Promise<ApiKeyRecord>;
}

export interface CreateApiKeyInput extends PermissionSelection {
  companyId: number;
  userId: number;
  name: string;
}

export class ApiKeyAdminError extends Error {
  constructor(
    readonly code: "invalid_name" | "invalid_owner",
    message: string
  ) {
    super(message);
    this.name = "ApiKeyAdminError";
  }
}

function validateOwner(id: number, field: string): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiKeyAdminError("invalid_owner", `${field} must be a positive integer`);
  }
}

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > 80 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new ApiKeyAdminError("invalid_name", "name must be 1-80 printable characters");
  }
  return normalized;
}

export async function createApiKey(
  store: ApiKeyStore,
  input: CreateApiKeyInput,
  random = randomBytes
): Promise<{ record: ApiKeyRecord; secret: string }> {
  validateOwner(input.companyId, "companyId");
  validateOwner(input.userId, "userId");

  const name = normalizeName(input.name);
  const selection = resolvePermissionSelection({
    profile: input.profile,
    permissions: input.permissions
  });
  const secret = `pcp_${random(32).toString("base64url")}`;
  const keyHash = createHash("sha256").update(secret).digest("hex");
  const keyPrefix = secret.slice(0, 12);

  const record = await store.create({
    companyId: input.companyId,
    userId: input.userId,
    name,
    keyHash,
    keyPrefix,
    permissions: selection.permissions,
    metadata: selection.profile ? { api_profile: selection.profile } : {}
  });

  return { record, secret };
}
