import type {
  ApiKeyProfile,
  ApiKeyProfileDefinition,
  ApiPermission,
  ApiPermissionGroup,
  PermissionDefinition
} from "./types.js";

const permissionRows: readonly [ApiPermission, ApiPermissionGroup, string, string, boolean][] = [
  ["channels:read", "channels", "Leer canales", "Consultar los canales disponibles.", false],
  ["contacts:read", "contacts", "Leer contactos", "Consultar contactos de la empresa.", false],
  ["contacts:write", "contacts", "Gestionar contactos", "Crear y actualizar contactos.", true],
  ["conversations:read", "conversations", "Leer conversaciones", "Consultar conversaciones y su historial.", false],
  ["conversations:write", "conversations", "Gestionar conversaciones", "Crear o actualizar conversaciones.", true],
  ["deals:read", "deals", "Leer negocios", "Consultar negocios, etapas y actividad.", false],
  ["deals:write", "deals", "Gestionar negocios", "Crear y actualizar negocios y etapas.", true],
  ["flows:read", "flows", "Leer flujos", "Consultar flujos y ejecuciones.", false],
  ["erp:read", "erp", "Leer ERP", "Consultar recursos ERP expuestos por la API.", false],
  ["media:upload", "media", "Subir multimedia", "Usar la capacidad de subida multimedia compatible.", true],
  ["messages:read", "messages", "Leer mensajes", "Consultar mensajes de conversaciones.", false],
  ["messages:send", "messages", "Enviar mensajes", "Enviar mensajes por canales autorizados.", true],
  ["notes:read", "notes", "Leer notas", "Consultar notas de contactos y conversaciones.", false],
  ["notes:write", "notes", "Gestionar notas", "Crear y actualizar notas.", true],
  ["pipelines:read", "pipelines", "Leer pipelines", "Consultar pipelines y etapas.", false],
  ["pipelines:write", "pipelines", "Gestionar pipelines", "Crear y actualizar pipelines y etapas.", true],
  ["tags:read", "tags", "Leer etiquetas", "Consultar etiquetas disponibles.", false],
  ["tags:write", "tags", "Gestionar etiquetas", "Añadir o quitar etiquetas.", true],
  ["tasks:read", "tasks", "Leer tareas", "Consultar tareas de la empresa.", false],
  ["tasks:write", "tasks", "Gestionar tareas", "Crear y actualizar tareas.", true],
  ["webhooks:manage", "webhooks", "Gestionar webhooks", "Registrar y administrar suscripciones.", true]
];

const permissionDefinitions: readonly PermissionDefinition[] = permissionRows.map(([name, group, label, description, dangerous]) => ({
  name: name as ApiPermission,
  group: group as PermissionDefinition["group"],
  label,
  description,
  dangerous
}));

const profiles: readonly ApiKeyProfileDefinition[] = [
  {
    name: "messaging",
    label: "Mensajeria",
    description: "Canales y mensajeria para integraciones basicas.",
    permissions: ["channels:read", "messages:read", "messages:send"]
  },
  {
    name: "crm_read_only",
    label: "CRM solo lectura",
    description: "Consulta del CRM sin permisos de escritura.",
    permissions: [
      "channels:read", "contacts:read", "conversations:read", "deals:read",
      "flows:read", "erp:read", "messages:read", "notes:read", "pipelines:read",
      "tags:read", "tasks:read"
    ]
  },
  {
    name: "smartbc_crm",
    label: "SmartBC CRM",
    description: "Perfil recomendado para una integracion CRM bidireccional.",
    permissions: [
      "channels:read", "contacts:read", "contacts:write", "conversations:read",
      "conversations:write", "deals:read", "deals:write", "flows:read", "erp:read",
      "messages:read", "messages:send", "notes:read", "notes:write", "pipelines:read",
      "tags:read", "tags:write", "tasks:read", "tasks:write", "webhooks:manage"
    ]
  },
  {
    name: "full_crm",
    label: "CRM completo",
    description: "Todos los permisos publicados del catalogo.",
    permissions: permissionDefinitions.map(({ name }) => name)
  }
];

export function listPermissionDefinitions(): readonly PermissionDefinition[] {
  return permissionDefinitions;
}

export function listProfiles(): readonly ApiKeyProfileDefinition[] {
  return profiles.map((profile) => ({
    ...profile,
    permissions: [...new Set(profile.permissions)].sort((left, right) => left.localeCompare(right))
  }));
}

export function getPermissionDefinition(permission: ApiPermission): PermissionDefinition | undefined {
  return permissionDefinitions.find((definition) => definition.name === permission);
}

export function getProfile(profile: ApiKeyProfile): ApiKeyProfileDefinition | undefined {
  const definition = profiles.find((candidate) => candidate.name === profile);
  return definition
    ? {
        ...definition,
        permissions: [...new Set(definition.permissions)].sort((left, right) => left.localeCompare(right))
      }
    : undefined;
}

export function isPermission(value: string): value is ApiPermission {
  return permissionDefinitions.some(({ name }) => name === value);
}

export function isProfile(value: string): value is ApiKeyProfile {
  return profiles.some(({ name }) => name === value);
}
