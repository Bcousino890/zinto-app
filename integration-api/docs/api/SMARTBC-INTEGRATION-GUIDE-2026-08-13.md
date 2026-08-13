# Integración SmartBC con Zinto

## 1. Propósito

Este documento es la guía operativa para conectar SmartBC con Zinto de forma bidireccional. La integración debe permitir que SmartBC consulte y actualice, según los permisos concedidos, los contactos, conversaciones, mensajes, notas, etiquetas, tareas, pipelines, deals y canales de Zinto. Los cambios originados en Zinto se notifican a SmartBC mediante webhooks firmados.

La empresa y el alcance de los datos se determinan exclusivamente por la API key. SmartBC no debe enviar `company_id` ni confiar en un identificador de empresa recibido desde el navegador.

**Estado actual:** el contrato principal de CRM tiene lecturas y escrituras controladas; Flows y ERP están publicados en este bloque como lectura. Las escrituras globales pueden permanecer cerradas aunque una API key tenga scopes de escritura. La apertura para SmartBC debe hacerse con una allowlist de empresa o de clave, nunca retirando la protección global para todos los partners.

## 2. URLs y autenticación

Base URL del contrato:

```text
https://crm.zinto.app/_integration-api
```

Todas las rutas protegidas usan:

```http
Authorization: Bearer pcp_<64 caracteres hexadecimales>
```

Ejemplo de comprobación:

```bash
export ZINTO_API_URL="https://crm.zinto.app/_integration-api"
export ZINTO_API_KEY="pcp_..."

curl --fail-with-body "$ZINTO_API_URL/api/v1/me" \
  -H "Authorization: Bearer $ZINTO_API_KEY"
```

La respuesta de `/api/v1/me` confirma la empresa, el nombre técnico de la clave y los scopes efectivos. La clave debe guardarse únicamente en el backend de SmartBC, nunca en JavaScript del navegador, URLs, logs, repositorios o tickets.

## 3. Scopes

| Scope | Capacidades |
|---|---|
| `channels:read` | Canales y capacidades disponibles |
| `contacts:read` | Listar, consultar y sincronizar contactos |
| `contacts:write` | Crear, actualizar y archivar contactos |
| `conversations:read` | Listar conversaciones |
| `conversations:write` | Crear o actualizar conversaciones |
| `messages:read` | Consultar mensajes e historial completo |
| `messages:send` | Enviar texto, media, plantillas e interactivos compatibles |
| `notes:read` | Leer notas de contactos |
| `notes:write` | Crear, editar y borrar notas |
| `tags:write` | Asociar y quitar etiquetas |
| `pipelines:read` | Leer pipelines y etapas |
| `pipelines:write` | Crear, editar y borrar pipelines y etapas |
| `deals:read` | Leer deals |
| `deals:write` | Crear, editar, borrar y mover deals |
| `tasks:read` | Leer tareas |
| `tasks:write` | Crear, editar y borrar tareas |
| `webhooks:manage` | Registrar, listar y desactivar webhooks |
| `flows:read` | Leer flows, sesiones, ejecuciones y plantillas |
| `erp:read` | Leer recursos ERP publicados |
| `inventory:read` | Leer almacenes y stock; se exige junto con `erp:read` |
| `*` | Acceso total; reservar para administración controlada |

Los scopes no abren por sí mismos las escrituras. La política operativa puede devolver `403` aunque la clave tenga el scope correcto. El operador debe autorizar explícitamente la empresa piloto y la clave antes de una prueba de escritura.

## 4. Matriz de endpoints

### Identidad y canales

| Método | Ruta | Scope |
|---|---|---|
| `GET` | `/api/v1/me` | autenticación |
| `GET` | `/api/v1/channels` | `channels:read` |

### Contactos, notas y etiquetas

| Método | Ruta | Scope |
|---|---|---|
| `GET` | `/api/v1/contacts` | `contacts:read` |
| `POST` | `/api/v1/contacts` | `contacts:write` |
| `GET` | `/api/v1/contacts/{id}` | `contacts:read` |
| `PATCH` | `/api/v1/contacts/{id}` | `contacts:write` |
| `DELETE` | `/api/v1/contacts/{id}` | `contacts:write` |
| `GET` | `/api/v1/contacts/{id}/notes` | `notes:read` |
| `POST` | `/api/v1/contacts/{id}/notes` | `notes:write` |
| `PATCH` | `/api/v1/notes/{id}` | `notes:write` |
| `DELETE` | `/api/v1/notes/{id}` | `notes:write` |
| `PUT` | `/api/v1/contacts/{id}/tags/{tag}` | `tags:write` |
| `DELETE` | `/api/v1/contacts/{id}/tags/{tag}` | `tags:write` |

### Conversaciones y mensajes

| Método | Ruta | Scope |
|---|---|---|
| `GET` | `/api/v1/conversations` | `conversations:read` |
| `POST` | `/api/v1/conversations` | `conversations:write` |
| `PATCH` | `/api/v1/conversations/{id}` | `conversations:write` |
| `GET` | `/api/v1/conversations/{id}/messages` | `messages:read` |
| `GET` | `/api/v1/messages/{id}` | `messages:read` |
| `POST` | `/api/v1/messages/send` | `messages:send` |
| `POST` | `/api/v1/messages/send-media` | `messages:send` |
| `POST` | `/api/v1/messages/send-template` | `messages:send` |
| `POST` | `/api/v1/messages/send-interactive` | `messages:send` |

El historial de mensajes se consulta por conversación y no se limita al día actual. SmartBC debe persistir el `id` de conversación de Zinto y recorrer todas las páginas con cursor.

### Pipelines, deals y tareas

| Método | Ruta | Scope |
|---|---|---|
| `GET` | `/api/v1/pipelines` | `pipelines:read` |
| `GET` | `/api/v1/pipelines/{id}/stages` | `pipelines:read` |
| `POST` | `/api/v1/pipelines` | `pipelines:write` |
| `PATCH` | `/api/v1/pipelines/{id}` | `pipelines:write` |
| `DELETE` | `/api/v1/pipelines/{id}` | `pipelines:write` |
| `POST` | `/api/v1/pipelines/{id}/stages` | `pipelines:write` |
| `PATCH` | `/api/v1/pipelines/{id}/stages/{stageId}` | `pipelines:write` |
| `DELETE` | `/api/v1/pipelines/{id}/stages/{stageId}` | `pipelines:write` |
| `GET` | `/api/v1/deals` | `deals:read` |
| `GET` | `/api/v1/deals/{id}` | `deals:read` |
| `POST` | `/api/v1/deals` | `deals:write` |
| `PATCH` | `/api/v1/deals/{id}` | `deals:write` |
| `DELETE` | `/api/v1/deals/{id}` | `deals:write` |
| `POST` | `/api/v1/deals/{id}/move` | `deals:write` |
| `PATCH` | `/api/v1/deals/{id}/stage` | `deals:write` |
| `GET` | `/api/v1/tasks` | `tasks:read` |
| `POST` | `/api/v1/tasks` | `tasks:write` |
| `PATCH` | `/api/v1/tasks/{id}` | `tasks:write` |
| `DELETE` | `/api/v1/tasks/{id}` | `tasks:write` |

Para cambiar un deal se debe usar `/move` con `pipeline_id` y `stage_id` reales. No se debe escribir directamente el campo histórico `stage` ni inventar nombres de etapas.

### Flows

| Método | Ruta | Scope | Estado |
|---|---|---|---|
| `GET` | `/api/v1/flows` | `flows:read` | lectura |
| `GET` | `/api/v1/flows/{id}` | `flows:read` | lectura |
| `GET` | `/api/v1/flows/{id}/sessions` | `flows:read` | lectura |
| `GET` | `/api/v1/flows/{id}/executions` | `flows:read` | lectura |
| `GET` | `/api/v1/flow-templates` | `flows:read` | lectura |

No hay todavía endpoints de creación, edición, activación o ejecución de flows.

### ERP

| Método | Ruta | Scopes |
|---|---|---|
| `GET` | `/api/v1/erp/products` | `erp:read` |
| `GET` | `/api/v1/erp/inventory/warehouses` | `erp:read`, `inventory:read` |
| `GET` | `/api/v1/erp/inventory/stock-levels` | `erp:read`, `inventory:read` |
| `GET` | `/api/v1/erp/suppliers` | `erp:read` |
| `GET` | `/api/v1/erp/sales-orders` | `erp:read` |
| `GET` | `/api/v1/erp/purchase-orders` | `erp:read` |
| `GET` | `/api/v1/erp/invoices` | `erp:read` |

El bloque ERP actual es de lectura. No incluye variantes, líneas detalladas, movimientos o transferencias de stock, pagos, contabilidad ni escrituras.

## 5. Patrón de respuesta y paginación

Las listas devuelven:

```json
{
  "data": [{ "id": "123" }],
  "meta": {
    "request_id": "req_...",
    "next_cursor": "opaque-cursor",
    "has_more": true
  }
}
```

Usar `limit` entre 1 y 200. Si `has_more` es `true`, repetir la misma ruta con `cursor` igual a `next_cursor`, sin interpretar ni modificar el cursor.

Para sincronización incremental, usar `updated_since` solo en los endpoints que lo documenten. Guardar el último instante procesado y añadir un pequeño solapamiento temporal; deduplicar por el ID de Zinto para no perder actualizaciones ocurridas en el límite.

Algoritmo recomendado:

1. Leer la primera página.
2. Persistir cada recurso por su ID de Zinto usando upsert.
3. Guardar `next_cursor` junto con el checkpoint.
4. Continuar hasta `has_more=false`.
5. Confirmar el checkpoint solo después de persistir la página completa.
6. En una repetición, aceptar duplicados y resolverlos por ID y `updated_at`.

## 6. Crear un contacto y enviar un mensaje

```bash
curl --fail-with-body --request POST \
  "$ZINTO_API_URL/api/v1/contacts" \
  -H "Authorization: Bearer $ZINTO_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: smartbc-contact-7e4b" \
  -d '{
    "name": "Cliente de prueba",
    "phone": "+34606806103"
  }'
```

Después de resolver o crear la conversación, enviar texto:

```bash
curl --fail-with-body --request POST \
  "$ZINTO_API_URL/api/v1/messages/send" \
  -H "Authorization: Bearer $ZINTO_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: smartbc-message-9c2a" \
  -d '{
    "conversation_id": "123",
    "body": "Mensaje enviado desde SmartBC"
  }'
```

El esquema exacto de cada cuerpo está en `openapi/openapi.yaml`; SmartBC debe generar sus tipos desde ese contrato y no inferir campos desde la interfaz web.

## 7. Idempotencia y reintentos

Usar un `Idempotency-Key` nuevo por operación lógica en cada POST, PATCH y DELETE que lo exija el contrato. Si una petición falla por red, repetir exactamente método, ruta, cuerpo y clave. Reutilizar la clave con otro cuerpo produce `409 idempotency_conflict`.

Un `504 delivery_timeout` significa que el proveedor pudo haber aceptado el mensaje. No crear otra clave inmediatamente: consultar el estado o esperar el webhook. Un `502 delivery_rejected` normalmente requiere corregir la petición; un `502 delivery_failed` puede reintentarse con la misma clave después de una espera.

## 8. Webhooks bidireccionales

Registrar un endpoint HTTPS con `POST /api/v1/webhooks` y el scope `webhooks:manage`. El secreto `whsec_...` se devuelve una sola vez.

Eventos disponibles actualmente:

```text
contact.created
contact.updated
contact.deleted
conversation.created
conversation.updated
message.created
message.status.updated
note.created
note.updated
note.deleted
tag.attached
tag.detached
deal.created
deal.updated
deal.stage.changed
deal.deleted
task.created
task.updated
task.completed
task.deleted
channel.connection.updated
```

Cabeceras:

```text
X-Zinto-Event-Id
X-Zinto-Timestamp
X-Zinto-Signature: v1=<hex>
```

La firma es HMAC-SHA256 del texto exacto `<timestamp>.<raw_body>` con el secreto del endpoint. Verificarla antes de parsear el JSON, rechazar timestamps fuera de una tolerancia de cinco minutos y deduplicar por `event.id`.

El receptor de SmartBC debe guardar el evento y responder `2xx` rápidamente; el procesamiento pesado debe hacerse después. Zinto puede entregar el mismo evento más de una vez, no garantiza orden global y reintenta fallos hasta diez intentos. Un mensaje entrante puede generar también `conversation.updated`; un cambio múltiple de etiquetas puede generar un evento de contacto y uno por etiqueta.

Ejemplo conceptual de verificación en Node.js:

```js
import crypto from "node:crypto";

function verify(rawBody, timestamp, signature, secret) {
  const expected = "v1=" + crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}
```

No usar el JSON reserializado para verificar la firma: debe conservarse el cuerpo HTTP original.

## 9. Errores

```json
{
  "error": {
    "code": "insufficient_scope",
    "message": "The API key lacks a required scope",
    "request_id": "req_..."
  }
}
```

Automatizar por `error.code`, no por el texto de `message`:

| HTTP | Tratamiento |
|---|---|
| `400` | Corregir validación, cursor o idempotencia |
| `401` | Revisar clave, expiración y formato Bearer |
| `403` | Revisar scope, allowlist de IP o apertura del piloto |
| `404` | Tratar como recurso no visible para esa empresa |
| `409` | Resolver conflicto o conservar la misma idempotency key |
| `422` | El canal no soporta el tipo de envío |
| `502` | Distinguir `delivery_rejected` de `delivery_failed` |
| `504` | Resultado de entrega desconocido; verificar antes de repetir |
| `500` | Reintentar con backoff y enviar `request_id` a soporte |

## 10. Seguridad de SmartBC

- Mantener la API key solo en backend.
- Usar una clave por empresa, ambiente y servicio.
- Permitir únicamente las IPs de salida estables de SmartBC.
- Rotar claves y revocar inmediatamente las expuestas.
- No registrar cuerpos completos de mensajes ni secretos de webhooks.
- Validar firma y timestamp antes de encolar un webhook.
- Persistir `event_id`, `request_id`, IDs de Zinto y estado de sincronización.
- Aplicar backoff y jitter ante `429`, `502`, `504` y errores transitorios.
- No asumir que el orden de eventos coincide con el orden de creación.

## 11. Prueba de aceptación para el piloto

Usar solamente los números autorizados: España `+34 606806103` y Chile `+56 9 91653343`, dentro de la empresa piloto `bcousinoprop`.

1. Confirmar `/health`, `/ready` y `/api/v1/me`.
2. Confirmar scopes efectivos de la clave SmartBC.
3. Leer un contacto y su historial completo.
4. Crear o actualizar un contacto con idempotencia.
5. Crear o localizar una conversación sin duplicarla.
6. Enviar texto por España y Chile, con canales explícitos.
7. Recibir una respuesta en cada número y procesar `message.created`.
8. Crear nota, etiqueta, deal y tarea desde SmartBC.
9. Cambiar la etapa del deal mediante IDs reales.
10. Confirmar que cada cambio aparece en Zinto y en SmartBC.
11. Repetir una petición con la misma clave y comprobar que no duplica.
12. Intentar consultar un ID de otra empresa y confirmar `404` tenant-safe.
13. Simular un webhook duplicado y confirmar una sola aplicación en SmartBC.
14. Revocar la clave y confirmar que las peticiones nuevas reciben `401`.

## 12. Capacidades todavía no publicadas

SmartBC no debe implementar contra supuestos para estas áreas:

- Creación, edición, activación o ejecución de Flows.
- Escrituras ERP.
- Variantes y líneas detalladas de ERP.
- Movimientos, transferencias y ajustes de stock.
- Pagos y contabilidad.
- Corrección del usuario técnico genérico que el motor legacy puede mostrar como autor de algunos mensajes enviados por API.
- Validación fuerte de `assigned_to` en tareas, cuyo campo heredado es texto libre.

Estas capacidades requieren contratos, pruebas de esquema, aislamiento por empresa, pruebas E2E y autorización de despliegue independientes.

## 13. Fuentes de verdad

- Contrato formal: `openapi/openapi.yaml`
- Autenticación: `docs/AUTHENTICATION.md`
- Errores: `docs/ERRORS.md`
- Paginación: `docs/PAGINATION.md`
- Idempotencia: `docs/IDEMPOTENCY.md`
- Webhooks: `docs/WEBHOOKS.md`
- Flows: `docs/api/FLOWS-API-2026-08-13.md`
- ERP: `docs/api/ERP-READ-API-2026-08-13.md`
