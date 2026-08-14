import type {
  ApiKeyCatalog,
  PermissionDefinition,
  PermissionId,
  PermissionProfile
} from "./types.js";

const permission = (
  id: PermissionId,
  group: string,
  label: string,
  description: string,
  readOnly = false
): PermissionDefinition => ({ id, group, label, description, readOnly });

export const PERMISSIONS: readonly PermissionDefinition[] = [
  permission("channels:read", "Canales", "Leer canales", "Consultar canales activos y sus capacidades", true),
  permission("contacts:read", "Contactos", "Leer contactos", "Listar y consultar contactos", true),
  permission("contacts:write", "Contactos", "Gestionar contactos", "Crear, actualizar y archivar contactos"),
  permission("conversations:read", "Conversaciones", "Leer conversaciones", "Listar conversaciones y su historial", true),
  permission("conversations:write", "Conversaciones", "Gestionar conversaciones", "Crear o reutilizar conversaciones"),
  permission("messages:read", "Mensajes", "Leer mensajes", "Consultar mensajes por conversación o ID", true),
  permission("messages:send", "Mensajes", "Enviar mensajes", "Enviar texto, media, plantillas e interactivos compatibles"),
  permission("notes:read", "Notas", "Leer notas", "Consultar notas de contactos", true),
  permission("notes:write", "Notas", "Gestionar notas", "Crear, editar y borrar notas"),
  permission("tags:write", "Etiquetas", "Gestionar etiquetas", "Asociar y quitar etiquetas"),
  permission("pipelines:read", "Pipeline", "Leer pipeline", "Consultar pipelines y etapas", true),
  permission("pipelines:write", "Pipeline", "Gestionar pipeline", "Crear, editar y borrar pipelines y etapas"),
  permission("deals:read", "Deals", "Leer deals", "Consultar negocios y su estado", true),
  permission("deals:write", "Deals", "Gestionar deals", "Crear, editar, borrar y mover negocios"),
  permission("tasks:read", "Tareas", "Leer tareas", "Consultar tareas", true),
  permission("tasks:write", "Tareas", "Gestionar tareas", "Crear, editar y borrar tareas"),
  permission("webhooks:manage", "Webhooks", "Gestionar webhooks", "Registrar, listar y desactivar webhooks"),
  permission("flows:read", "Flows", "Leer flows", "Consultar flows, asignaciones y ejecuciones agregadas", true),
  permission("erp.products:read", "ERP", "Leer productos", "Consultar productos del ERP", true),
  permission("erp.inventory:read", "ERP", "Leer inventario", "Consultar niveles de stock", true),
  permission("erp.sales-orders:read", "ERP", "Leer pedidos", "Consultar pedidos de venta", true),
  permission("erp.invoices:read", "ERP", "Leer facturas", "Consultar facturas", true)
] as const;

export const PROFILES: readonly PermissionProfile[] = [
  {
    id: "crm_read_only",
    label: "CRM: solo lectura",
    description: "Consulta CRM, mensajería, Flows y ERP sin crear ni modificar datos.",
    permissions: PERMISSIONS.filter((item) => item.readOnly).map((item) => item.id)
  },
  {
    id: "messaging",
    label: "Mensajería",
    description: "Lee canales, conversaciones y mensajes, y permite enviar mensajes.",
    permissions: ["channels:read", "conversations:read", "messages:read", "messages:send"]
  },
  {
    id: "smartbc_crm",
    label: "SmartBC CRM",
    description: "Integración bidireccional CRM completa para un partner autorizado.",
    permissions: PERMISSIONS.map((item) => item.id)
  }
] as const;

export const CATALOG: ApiKeyCatalog = {
  permissions: [...PERMISSIONS],
  profiles: [...PROFILES]
};
