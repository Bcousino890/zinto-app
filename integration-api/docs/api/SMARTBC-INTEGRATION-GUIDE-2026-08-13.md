# Integracion SmartBC con Zinto

## 1. Proposito y estado del contrato

Esta guia describe el contrato que SmartBC puede consumir para sincronizar
contactos, conversaciones, mensajes, notas, etiquetas, pipelines, deals,
tareas, Flows y una proyeccion ERP de Zinto. La empresa se determina
exclusivamente por la API key: SmartBC no debe enviar `company_id`.

El runtime actual publica CRM de lectura y escritura controlada. Flows y ERP
son solo de lectura. Los scopes no abren por si solos las escrituras: Zinto
puede exigir que la empresa o la API key este en una allowlist operativa.
Una peticion de escritura fuera de esa allowlist recibe `403` aunque el scope
este concedido.

## 2. URL y autenticacion

```text
https://crm.zinto.app/_integration-api
```

Las rutas protegidas usan:

```http
Authorization: Bearer pcp_<64 caracteres hexadecimales>
```

```bash
export ZINTO_API_URL="https://crm.zinto.app/_integration-api"
export ZINTO_API_KEY="pcp_..."

curl --fail-with-body "$ZINTO_API_URL/api/v1/me" \
  -H "Authorization: Bearer $ZINTO_API_KEY"
```

La respuesta de `/api/v1/me` confirma la empresa, la clave y sus scopes
efectivos. Guarda la clave solo en el backend de SmartBC: nunca en el
navegador, URLs, logs, repositorios, tickets o capturas.

## 3. Scopes exactos

| Scope | Capacidades del runtime |
|---|---|
| `channels:read` | Leer canales y sus capacidades |
| `contacts:read` | Listar y consultar contactos |
| `contacts:write` | Crear, actualizar y archivar contactos |
| `conversations:read` | Listar conversaciones |
| `conversations:write` | Crear/reutilizar y actualizar conversaciones |
| `messages:read` | Leer mensajes por conversacion o por ID |
| `messages:send` | Enviar texto, media, plantillas e interactivos compatibles |
| `notes:read` | Leer notas de un contacto; se usa junto con `contacts:read` |
| `notes:write` | Crear, editar y borrar notas |
| `tags:write` | Asociar y quitar etiquetas |
| `pipelines:read` | Leer pipelines y etapas |
| `pipelines:write` | Crear, editar y borrar pipelines y etapas |
| `deals:read` | Leer deals |
| `deals:write` | Crear, editar, borrar y mover deals |
| `tasks:read` | Leer tareas |
| `tasks:write` | Crear, editar y borrar tareas |
| `webhooks:manage` | Registrar, listar y desactivar webhooks |
| `flows:read` | Leer flows, asignaciones y ejecuciones agregadas |
| `erp.products:read` | Leer productos ERP |
| `erp.inventory:read` | Leer niveles de stock ERP |
| `erp.sales-orders:read` | Leer pedidos de venta ERP |
| `erp.invoices:read` | Leer invoices ERP |
| `*` | Acceso total; reservar para administracion controlada |

`media:upload` no es un scope de este contrato publico y no debe usarse para
inferir que existe una subida de archivos en `/_integration-api`.

## 4. Matriz exacta de endpoints

### Identidad y canales

| Metodo | Ruta | Scope |
|---|---|---|
| `GET` | `/api/v1/me` | Clave valida |
| `GET` | `/api/v1/channels` | `channels:read` |

### Contactos, notas y etiquetas

| Metodo | Ruta | Scope |
|---|---|---|
| `GET` | `/api/v1/contacts` | `contacts:read` |
| `GET` | `/api/v1/contacts/{id}` | `contacts:read` |
| `POST` | `/api/v1/contacts` | `contacts:write` |
| `PATCH` | `/api/v1/contacts/{id}` | `contacts:write` |
| `DELETE` | `/api/v1/contacts/{id}` | `contacts:write` |
| `GET` | `/api/v1/contacts/{id}/notes` | `contacts:read` y `notes:read` |
| `POST` | `/api/v1/contacts/{id}/notes` | `notes:write` |
| `PATCH` | `/api/v1/notes/{id}` | `notes:write` |
| `DELETE` | `/api/v1/notes/{id}` | `notes:write` |
| `PUT` | `/api/v1/contacts/{id}/tags/{tag}` | `tags:write` |
| `DELETE` | `/api/v1/contacts/{id}/tags/{tag}` | `tags:write` |

### Conversaciones y mensajes

| Metodo | Ruta | Scope |
|---|---|---|
| `GET` | `/api/v1/conversations` | `conversations:read` |
| `POST` | `/api/v1/conversations` | `conversations:write` |
| `PATCH` | `/api/v1/conversations/{id}` | `conversations:write` |
| `GET` | `/api/v1/conversations/{id}/messages` | `conversations:read` y `messages:read` |
| `GET` | `/api/v1/messages/{id}` | `messages:read` |
| `POST` | `/api/v1/messages/send` | `messages:send` |
| `POST` | `/api/v1/messages/send-media` | `messages:send` |
| `POST` | `/api/v1/messages/send-template` | `messages:send` |
| `POST` | `/api/v1/messages/send-interactive` | `messages:send` |

`POST /api/v1/conversations` busca una conversacion por `contact_id` y
`channel_id` dentro de la empresa de la clave. Devuelve `201` si la crea y
`200` si reutiliza una existente. No crea duplicados deliberadamente.

### Pipelines, deals y tareas

| Metodo | Ruta | Scope |
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

Para mover un deal usa IDs numericos reales. `/move` recibe `pipeline_id` y
`stage_id`; `/stage` recibe solo `stage_id`. No escribas el campo historico
`stage` con un nombre inventado.

### Flows: solo lectura

| Metodo | Ruta | Scope |
|---|---|---|
| `GET` | `/api/v1/flows` | `flows:read` |
| `GET` | `/api/v1/flows/{id}` | `flows:read` |
| `GET` | `/api/v1/flows/{id}/assignments` | `flows:read` |
| `GET` | `/api/v1/flow-executions` | `flows:read` |

`/api/v1/flow-executions` acepta opcionalmente `flow_id`, `status`,
`updated_since`, `cursor` y `limit`. No hay rutas publicas para crear, editar,
activar, ejecutar, pausar o borrar Flows. Las rutas alternativas
`/flows/{id}/sessions`, `/flows/{id}/executions` y `/flow-templates` no forman
parte del runtime publicado actual.

### ERP: solo lectura

| Metodo | Ruta | Scope |
|---|---|---|
| `GET` | `/api/v1/erp/products` | `erp.products:read` |
| `GET` | `/api/v1/erp/products/{id}` | `erp.products:read` |
| `GET` | `/api/v1/erp/stock-levels` | `erp.inventory:read` |
| `GET` | `/api/v1/erp/sales-orders` | `erp.sales-orders:read` |
| `GET` | `/api/v1/erp/sales-orders/{id}` | `erp.sales-orders:read` |
| `GET` | `/api/v1/erp/invoices` | `erp.invoices:read` |
| `GET` | `/api/v1/erp/invoices/{id}` | `erp.invoices:read` |

No publiques de esta version las rutas de warehouses, suppliers,
purchase-orders, movimientos o transferencias de stock. Tampoco hay escrituras
ERP, variantes, lineas detalladas, pagos ni contabilidad en este contrato.

## 5. Respuestas y paginacion

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

`limit` acepta de 1 a 200 y por defecto es 50. El cursor es opaco: reenvia
`meta.next_cursor` sin modificarlo. Las rutas que aceptan `updated_since`
documentan ese parametro explicitamente; usa un solapamiento temporal y
deduplica por ID.

## 6. Flujo minimo correcto: contacto, conversacion y mensaje

Crear un contacto. Si el telefono ya existe en la misma empresa, la respuesta
es `409 contact_already_exists`; en ese caso busca y reutiliza el contacto.

```bash
curl --fail-with-body --request POST \
  "$ZINTO_API_URL/api/v1/contacts" \
  -H "Authorization: Bearer $ZINTO_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: smartbc-contact-7e4b" \
  -d '{
    "name": "Cliente de prueba",
    "phone": "+34600000000"
  }'
```

Crear o localizar una conversacion con el contacto y canal reales:

```bash
curl --fail-with-body --request POST \
  "$ZINTO_API_URL/api/v1/conversations" \
  -H "Authorization: Bearer $ZINTO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contact_id": "123",
    "channel_id": "456"
  }'
```

Leer el historial completo y un mensaje individual:

```bash
curl --fail-with-body \
  "$ZINTO_API_URL/api/v1/conversations/789/messages?limit=50" \
  -H "Authorization: Bearer $ZINTO_API_KEY"

curl --fail-with-body \
  "$ZINTO_API_URL/api/v1/messages/701" \
  -H "Authorization: Bearer $ZINTO_API_KEY"
```

Enviar texto. El runtime exige `channel_id`, `to` y `message`; no acepta el
formato antiguo `conversation_id` + `body` en esta ruta.

```bash
curl --fail-with-body --request POST \
  "$ZINTO_API_URL/api/v1/messages/send" \
  -H "Authorization: Bearer $ZINTO_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: smartbc-message-9c2a" \
  -d '{
    "channel_id": "456",
    "to": "+34600000000",
    "message": "Mensaje enviado desde SmartBC"
  }'
```

Formato `send-media`:

```json
{
  "channel_id": "456",
  "to": "+34600000000",
  "media_type": "document",
  "media_url": "https://cdn.example.test/file.pdf",
  "caption": "Documento",
  "filename": "file.pdf"
}
```

Formato `send-template`:

```json
{
  "channel_id": "456",
  "to": "+34600000000",
  "template_name": "bienvenida",
  "template_language": "es",
  "components": []
}
```

Formato `send-interactive`:

```json
{
  "channel_id": "456",
  "to": "+34600000000",
  "interactive_type": "button",
  "body": "Elige una opcion",
  "action": { "buttons": [] }
}
```

Todos los envios comprueban que el canal pertenece a la empresa, esta activo
y anuncia la capacidad solicitada. Media ademas requiere que el proxy seguro
este habilitado; si esta desactivado responde `503 media_proxy_disabled`.
`media:upload` no habilita este endpoint.

## 7. Idempotencia y reintentos

Usa `Idempotency-Key` en contactos, notas y operaciones de escritura que lo
exijan. En un reintento de red repite metodo, ruta, cuerpo y clave exactamente.
Cambiar el cuerpo con la misma clave produce `409 idempotency_conflict`.

Un `504 delivery_timeout` deja el resultado del proveedor en estado incierto:
reconcilia antes de enviar de nuevo. Un `502 delivery_rejected` indica una
peticion que el motor rechazo; `delivery_failed` indica un fallo del motor.

## 8. Webhooks bidireccionales

Registrar un receptor HTTPS con `POST /api/v1/webhooks` y `webhooks:manage`:

```json
{
  "url": "https://smartbc.example.test/webhooks/zinto",
  "event_types": ["contact.updated", "message.created"]
}
```

El secreto `whsec_...` se muestra una sola vez. Zinto entrega eventos al menos
una vez y SmartBC debe deduplicar por `event.id`. La firma es HMAC-SHA256 del
texto exacto `<timestamp>.<raw_body>`:

```http
X-Zinto-Event-Id: 550e8400-e29b-41d4-a716-446655440000
X-Zinto-Timestamp: 1786582800
X-Zinto-Signature: v1=<hex>
```

Verifica la firma antes de parsear, rechaza timestamps con mas de cinco minutos
y responde `2xx` solo despues de persistir el evento. El worker y la allowlist
de escrituras son configuraciones operativas separadas de los scopes.

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

Automatiza por `error.code`, no por el texto humano:

| HTTP | Tratamiento |
|---|---|
| `400` | Corregir cuerpo, parametros, ID o cursor |
| `401` | Revisar clave, expiracion y formato Bearer |
| `403` | Revisar scope, IP y allowlist operativa |
| `404` | Tratar como recurso no visible para esa empresa |
| `409` | Resolver duplicado/conflicto o reutilizar la misma clave |
| `422` | El canal o la etapa no admite la operacion |
| `502` | Distinguir `delivery_rejected` de `delivery_failed` |
| `503` | Revisar disponibilidad o `media_proxy_disabled` |
| `504` | Resultado de entrega desconocido; reconciliar antes de repetir |

## 10. Limitaciones explicitas del contrato

- Flows solo permite lectura de flows, asignaciones y ejecuciones agregadas.
- ERP solo permite los siete recursos indicados en esta guia y solo en lectura.
- No existen escrituras de Flows ni ERP, ni variantes, pagos, contabilidad,
  movimientos o transferencias de stock.
- `tasks.assigned_to` es texto libre; no se valida contra un usuario Zinto.
- Algunos mensajes enviados por el adaptador legacy pueden mostrar un usuario
  tecnico generico como autor en la interfaz del CRM.
- El rate limit es local al proceso; no debe tratarse como una cuota global si
  se despliegan varias replicas.
- Un webhook se crea, lista y desactiva; no existe rotacion publica del secreto.
- La habilitacion de escritura y los scopes son controles independientes.

## 11. Prueba de aceptacion SmartBC

Usar solamente los numeros autorizados del piloto: España `+34 606806103` y
Chile `+56 9 91653343`, dentro de `bcousinoprop`.

1. Confirmar `/health`, `/ready` y `/api/v1/me`.
2. Confirmar scopes efectivos y canales activos.
3. Leer contactos, conversaciones y mensajes antiguos con paginacion.
4. Crear o localizar una conversacion sin duplicarla.
5. Enviar texto con `channel_id`, `to` y `message`.
6. Crear nota, etiqueta, deal y tarea con los scopes correspondientes.
7. Mover el deal usando IDs reales de pipeline y etapa.
8. Registrar un webhook y verificar firma, deduplicacion y respuesta `2xx`.
9. Intentar consultar un ID de otra empresa y confirmar `404` tenant-safe.
10. Repetir una operacion idempotente y confirmar que no duplica.

## 12. Fuentes de verdad

- Contrato formal: `openapi/openapi.yaml`
- Matriz SmartBC: `docs/SMARTBC-COMPATIBILITY.md`
- Autenticacion: `docs/AUTHENTICATION.md`
- Paginacion: `docs/PAGINATION.md`
- Idempotencia: `docs/IDEMPOTENCY.md`
- Webhooks: `docs/WEBHOOKS.md`
- Flows: `docs/api/FLOWS-API-2026-08-13.md`
- ERP: `docs/api/ERP-READ-API-2026-08-13.md`
