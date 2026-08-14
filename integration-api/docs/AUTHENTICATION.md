# Autenticacion y permisos

Todas las operaciones excepto `GET /health` y `GET /ready` requieren una clave
API en el encabezado `Authorization`:

```http
Authorization: Bearer pcp_<64 caracteres hexadecimales>
```

La clave identifica simultaneamente:

- la empresa propietaria de los datos;
- el usuario tecnico usado para auditoria;
- los permisos concedidos;
- restricciones opcionales de IP y expiracion.

Nunca envies `company_id`: Zinto lo obtiene de la clave y filtra cada consulta
y modificacion por esa empresa. Una integracion no puede cambiar de empresa
mediante parametros del cliente.

## Scopes

| Scope | Uso |
| --- | --- |
| `channels:read` | Consultar canales disponibles |
| `contacts:read` | Leer contactos |
| `contacts:write` | Crear, actualizar y archivar contactos |
| `conversations:read` | Leer conversaciones |
| `messages:read` | Leer el historial de mensajes |
| `messages:send` | Enviar mensajes por canales compatibles |
| `notes:read` | Listar notas de un contacto |
| `notes:write` | Crear, editar y borrar notas |
| `tags:write` | Asociar y quitar etiquetas |
| `pipelines:read` | Leer pipelines y sus etapas |
| `deals:read` | Leer oportunidades |
| `deals:write` | Cambiar la etapa de una oportunidad |
| `tasks:read` | Leer tareas de contactos |
| `conversations:write` | Crear o reencontrar conversaciones uno-a-uno |
| `flows:read` | Leer metadatos, asignaciones y ejecuciones seguras de Flows |
| `erp.products:read` | Leer productos ERP seguros |
| `erp.inventory:read` | Leer niveles de existencias ERP |
| `erp.sales-orders:read` | Leer cabeceras de pedidos de venta ERP |
| `erp.invoices:read` | Leer cabeceras de facturas ERP |
| `webhooks:manage` | Registrar, listar y desactivar webhooks |
| `*` | Acceso completo; reservar para administracion controlada |

`GET /api/v1/me` devuelve los scopes efectivos. Si falta alguno, la API
responde `403 insufficient_scope`.

El contrato OpenAPI declara el permiso exacto de cada operacion mediante
`x-required-scopes`. La matriz completa para SmartBC esta en
`docs/SMARTBC-COMPATIBILITY.md`.

## Custodia de claves

- Guarda la clave en un gestor de secretos o variable de entorno.
- No la incluyas en URLs, codigo fuente, logs, capturas o tickets.
- Usa claves distintas por sistema y ambiente.
- Configura una lista de IPs cuando el origen sea estable.
- Desactiva y reemplaza una clave inmediatamente si se expone.
