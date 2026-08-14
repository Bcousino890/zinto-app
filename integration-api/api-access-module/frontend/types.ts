export type PermissionId =
  | "channels:read"
  | "contacts:read"
  | "contacts:write"
  | "conversations:read"
  | "conversations:write"
  | "messages:read"
  | "messages:send"
  | "notes:read"
  | "notes:write"
  | "tags:write"
  | "pipelines:read"
  | "pipelines:write"
  | "deals:read"
  | "deals:write"
  | "tasks:read"
  | "tasks:write"
  | "webhooks:manage"
  | "flows:read"
  | "erp.products:read"
  | "erp.inventory:read"
  | "erp.sales-orders:read"
  | "erp.invoices:read";

export type PermissionProfileId = "crm_read_only" | "smartbc_crm" | "messaging";

export interface PermissionDefinition {
  id: PermissionId;
  group: string;
  label: string;
  description: string;
  readOnly?: boolean;
}

export interface PermissionProfile {
  id: PermissionProfileId;
  label: string;
  description: string;
  permissions: readonly PermissionId[];
}

export interface ApiKeyCreateRequest {
  name: string;
  profile?: PermissionProfileId;
  permissions?: PermissionId[];
}

export interface ApiKeyCreateResponse {
  id: number;
  name: string;
  permissions: PermissionId[];
  key?: string;
}

export interface ApiKeyCatalog {
  permissions: PermissionDefinition[];
  profiles: PermissionProfile[];
}
