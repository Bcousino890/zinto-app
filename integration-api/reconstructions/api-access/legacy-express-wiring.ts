/**
 * Framework-neutral wiring contract for the recovered Express CRM.
 *
 * The old source has a session middleware (`isAuth`) and mounts routers from
 * `backend/src/routes/index.ts`. The production-safe implementation should
 * adapt these callbacks to the existing Express response object rather than
 * duplicating API-key generation or permission validation in a route handler.
 */
import { apiKeyCatalog, postApiKey } from "./http-adapter.js";
import type { AdminRequest, AdminResponse, AdminContext } from "./http-adapter.js";

export interface LegacySessionUser {
  id: string | number;
  companyId: number;
  profile: string;
}

export interface LegacyRouteDependencies {
  store: AdminContext["store"];
  random?: AdminContext["random"];
  isAdmin?: (user: LegacySessionUser) => boolean;
}

export function isLegacyAdmin(user: LegacySessionUser): boolean {
  return ["admin", "superadmin", "super"].includes(user.profile.toLowerCase());
}

export function legacyCatalogHandler(response: AdminResponse): Promise<void> {
  response.status(200).json({ data: apiKeyCatalog() });
  return Promise.resolve();
}

export function legacyCreateKeyHandler(
  user: LegacySessionUser | undefined,
  body: unknown,
  response: AdminResponse,
  dependencies: LegacyRouteDependencies
): Promise<void> {
  const request: AdminRequest = {
    body,
    session: user
      ? {
          userId: Number(user.id),
          companyId: user.companyId,
          isAdmin: (dependencies.isAdmin ?? isLegacyAdmin)(user)
        }
      : undefined
  };
  return postApiKey(request, response, {
    store: dependencies.store,
    random: dependencies.random
  });
}
