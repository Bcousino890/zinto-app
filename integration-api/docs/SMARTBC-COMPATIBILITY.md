# Contrato de compatibilidad SmartBC

Esta matriz refleja las rutas que registra el runtime actual de Integration
API. No documenta las implementaciones alternativas que no se conectan en
produccion. La empresa se obtiene de la API key y nunca de `company_id`.

## URL base

| Concepto | URL |
|---|---|
| Servicio | `https://crm.zinto.app/_integration-api` |
| Recursos REST | `https://crm.zinto.app/_integration-api/api/v1` |
| Health | `https://crm.zinto.app/_integration-api/health` |
| Readiness | `https://crm.zinto.app/_integration-api/ready` |

No uses `https://crm.zinto.app/api/v1` para este contrato y no dupliques
`/_integration-api` o `/api/v1` en el cliente.

## Headers

```http
Authorization: Bearer pcp_<64 caracteres hexadecimales>
Content-Type: application/json
Idempotency-Key: <clave de la operacion cuando corresponda>
```

`Content-Type` se envia cuando existe cuerpo JSON. Nunca se envia
`company_id`. Las claves se guardan solo en backend.

## Rutas y scopes

| Metodo | Ruta | Scope exacto |
|---|---|---|
| `GET` | `/health` | Publica |
| `GET` | `/ready` | Publica |
| `GET` | `/api/v1/me` | Clave valida |
| `GET` | `/api/v1/channels` | `channels:read` |
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
| `GET` | `/api/v1/conversations` | `conversations:read` |
| `POST` | `/api/v1/conversations` | `conversations:write` |
| `PATCH` | `/api/v1/conversations/{id}` | `conversations:write` |
| `GET` | `/api/v1/conversations/{id}/messages` | `conversations:read` y `messages:read` |
| `GET` | `/api/v1/messages/{id}` | `messages:read` |
| `POST` | `/api/v1/messages/send` | `messages:send` |
| `POST` | `/api/v1/messages/send-media` | `messages:send` |
| `POST` | `/api/v1/messages/send-template` | `messages:send` |
| `POST` | `/api/v1/messages/send-interactive` | `messages:send` |
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
| `GET` | `/api/v1/flows` | `flows:read` |
| `GET` | `/api/v1/flows/{id}` | `flows:read` |
| `GET` | `/api/v1/flows/{id}/assignments` | `flows:read` |
| `GET` | `/api/v1/flow-executions` | `flows:read` |
| `GET` | `/api/v1/erp/products` | `erp.products:read` |
| `GET` | `/api/v1/erp/products/{id}` | `erp.products:read` |
| `GET` | `/api/v1/erp/stock-levels` | `erp.inventory:read` |
| `GET` | `/api/v1/erp/sales-orders` | `erp.sales-orders:read` |
| `GET` | `/api/v1/erp/sales-orders/{id}` | `erp.sales-orders:read` |
| `GET` | `/api/v1/erp/invoices` | `erp.invoices:read` |
| `GET` | `/api/v1/erp/invoices/{id}` | `erp.invoices:read` |
| `POST` | `/api/v1/webhooks` | `webhooks:manage` |
| `GET` | `/api/v1/webhooks` | `webhooks:manage` |
| `DELETE` | `/api/v1/webhooks/{id}` | `webhooks:manage` |

El runtime actual no publica `/flows/{id}/sessions`, `/flows/{id}/executions`,
`/flow-templates`, `/erp/inventory/warehouses`, `/erp/suppliers` ni
`/erp/purchase-orders`. No deben usarse aunque existan documentos antiguos que
los mencionen.

## Cuerpos criticos

Crear o reutilizar una conversacion:

```json
{
  "contact_id": "123",
  "channel_id": "456"
}
```

Enviar texto:

```json
{
  "channel_id": "456",
  "to": "+34600000000",
  "message": "Hola desde SmartBC"
}
```

Enviar media:

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

La ruta de texto no acepta `conversation_id` + `body`. `send-media` puede
devolver `503 media_proxy_disabled` si el proxy seguro no esta habilitado;
`media:upload` no forma parte de este contrato.

## Paginacion e incremental

Las listas responden con `data` y `meta.next_cursor`/`meta.has_more`. `limit`
va de 1 a 200 y el valor por defecto es 50. El cursor es opaco. Las rutas que
aceptan `updated_since` lo indican en OpenAPI y en la guia principal; no se
debe enviar ese parametro a rutas que no lo acepten.

## Webhooks

Crear un endpoint requiere `webhooks:manage` y este cuerpo:

```json
{
  "url": "https://smartbc.example.test/webhooks/zinto",
  "event_types": ["message.created", "contact.updated"]
}
```

El secreto `whsec_...` solo aparece al crear el endpoint. La firma usa
`v1=HMAC_SHA256(secret, timestamp + "." + raw_body)`, recibida en
`X-Zinto-Signature`, con `X-Zinto-Event-Id` y `X-Zinto-Timestamp`. SmartBC debe
verificar el cuerpo original, rechazar timestamps de mas de cinco minutos,
persistir antes de responder `2xx` y deduplicar por `event.id`.

## Compatibilidad y limitaciones

- Los IDs se serializan como strings aunque la base use enteros.
- Un recurso de otra empresa responde como no encontrado (`404` tenant-safe).
- Los errores deben tratarse por `error.code`, no por el texto humano.
- `409 contact_already_exists` significa que el telefono ya existe en esa
  empresa; SmartBC debe localizar y reutilizar el contacto.
- Flows y ERP son lectura; no hay mutaciones publicas de esos modulos.
- `tasks.assigned_to` es texto libre y no valida un usuario de la empresa.
- El motor legacy puede mostrar un autor tecnico generico en mensajes enviados.
- La allowlist operativa es independiente de los scopes de la API key.
