import { ApiError } from "../http/errors.js";

export function assertScopes(granted: readonly string[], required: readonly string[]): void {
  if (granted.includes("*") || required.every((scope) => granted.includes(scope))) {
    return;
  }

  throw new ApiError(403, "insufficient_scope", "The API key lacks a required scope");
}
