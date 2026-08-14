export type ApiPermission =
  | "channels:read"
  | "contacts:read"
  | "contacts:write"
  | "conversations:read"
  | "conversations:write"
  | "deals:read"
  | "deals:write"
  | "flows:read"
  | "erp:read"
  | "media:upload"
  | "messages:read"
  | "messages:send"
  | "notes:read"
  | "notes:write"
  | "pipelines:read"
  | "pipelines:write"
  | "tags:read"
  | "tags:write"
  | "tasks:read"
  | "tasks:write"
  | "webhooks:manage";

export type ApiPermissionGroup =
  | "channels"
  | "contacts"
  | "conversations"
  | "deals"
  | "flows"
  | "erp"
  | "media"
  | "messages"
  | "notes"
  | "pipelines"
  | "tags"
  | "tasks"
  | "webhooks";

export type ApiKeyProfile =
  | "messaging"
  | "crm_read_only"
  | "smartbc_crm"
  | "full_crm";

export interface PermissionDefinition {
  readonly name: ApiPermission;
  readonly group: ApiPermissionGroup;
  readonly label: string;
  readonly description: string;
  readonly dangerous: boolean;
}

export interface ApiKeyProfileDefinition {
  readonly name: ApiKeyProfile;
  readonly label: string;
  readonly description: string;
  readonly permissions: readonly ApiPermission[];
}

export interface PermissionSelection {
  readonly permissions?: readonly string[];
  readonly profile?: string;
}

export interface ResolvedPermissionSelection {
  readonly source: "permissions" | "profile";
  readonly profile?: ApiKeyProfile;
  readonly permissions: readonly ApiPermission[];
}

