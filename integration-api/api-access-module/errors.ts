export type PermissionValidationCode =
  | "invalid_body"
  | "invalid_name"
  | "invalid_profile"
  | "invalid_permissions"
  | "unknown_permission"
  | "unknown_profile"
  | "ambiguous_selection"
  | "missing_selection";

export class PermissionValidationError extends Error {
  readonly code: PermissionValidationCode;
  readonly details: readonly string[];

  constructor(code: PermissionValidationCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = "PermissionValidationError";
    this.code = code;
    this.details = details;
  }
}
