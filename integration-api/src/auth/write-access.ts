import type { ApiPrincipal } from "./api-key.js";
import { ApiError } from "../http/errors.js";

export interface WriteAccessPolicy {
  enabledApiKeyIds: ReadonlySet<number>;
  enabledCompanyIds: ReadonlySet<number>;
}

export function allowsAnyWrite(policy: WriteAccessPolicy): boolean {
  return policy.enabledApiKeyIds.size > 0 || policy.enabledCompanyIds.size > 0;
}

export function assertWriteEnabled(policy: WriteAccessPolicy, principal: ApiPrincipal): void {
  if (policy.enabledApiKeyIds.has(principal.apiKeyId)) return;
  if (policy.enabledCompanyIds.has(principal.companyId)) return;
  throw new ApiError(503, "read_only_mode", "Write operations are temporarily disabled");
}
