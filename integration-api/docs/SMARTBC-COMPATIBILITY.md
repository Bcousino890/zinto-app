# Contrato de compatibilidad SmartBC

Este documento fija el contrato de Integration API que SmartBC puede consumir
en la version `0.1.0`. Es una vista operativa de `openapi/openapi.yaml`; no
habilita escrituras ni cambia el estado del preview.

## URL base sin ambiguedad

| Concepto | URL |
| --- | --- |
| Raiz externa del servicio | `https://crm.zinto.app/_integration-api` |
| Base de recursos REST | `https://crm.zinto.app/_integration-api/api/v1` |
| Health | `https://crm.zinto.app/_integration-api/health` |
| Readiness | `https://crm.zinto.app/_integration-api/ready` |

Las rutas de OpenAPI incluyen `/api/v1`. Por tanto, `servers[0].url` es la raiz
del servicio, no la base de recursos. No dupliques segmentos como
`/_integration-api/_integration-api` o `/api/v1/api/v1`, y no uses
`https://crm.zinto.app/api/v1`: esa ruta pertenece al CRM recuperado, no a este
servicio.

`examples/node-client.ts` acepta `ZINTO_API_URL` en cualquiera de estas dos
formas para facilitar configuraciones SmartBC ya existentes:

```text
https://crm.zinto.app/_integration-api
https://crm.zinto.app/_integration-api/api/v1
```

## Headers de llamadas a Zinto

```http
Authorization: Bearer pcp_<64 caracteres hexadecimales en minuscula>
Content-Type: application/json
Idempotency-Key: <identificador unico de la operacion>
```

`Authorization` es obligatorio en todos los recursos `/api/v1`. `Content-Type`
se usa cuando hay cuerpo JSON. `Idempotency-Key` es obligatorio en creacion de
contactos, creacion de notas y todos los envios de mensajes. Nunca envies
`company_id`; la empresa procede de la clave.

## Rutas implementadas y scopes

| Metodo | Ruta | Scope exacto |
| --- | --- | --- |
| `GET` | `/health` | Publico |
| `GET` | `/ready` | Publico |
| `GET` | `/api/v1/me` | Clave valida, sin scope adicional |
| `GET` | `/api/v1/channels` | `channels:read` |
| `GET` | `/api/v1/contacts` | `contacts:read` |
| `POST` | `/api/v1/contacts` | `contacts:write` |
| `PATCH` | `/api/v1/contacts/{id}` | `contacts:write` |
| `DELETE` | `/api/v1/contacts/{id}` | `contacts:write` |
| `POST` | `/api/v1/contacts/{id}/notes` | `notes:write` |
| `PATCH` | `/api/v1/notes/{id}` | `notes:write` |
| `DELETE` | `/api/v1/notes/{id}` | `notes:write` |
| `PUT` | `/api/v1/contacts/{id}/tags/{tag}` | `tags:write` |
| `DELETE` | `/api/v1/contacts/{id}/tags/{tag}` | `tags:write` |
| `GET` | `/api/v1/conversations` | `conversations:read` |
| `GET` | `/api/v1/conversations/{id}/messages` | `conversations:read` y `messages:read` |
| `POST` | `/api/v1/messages/send` | `messages:send` |
| `POST` | `/api/v1/messages/send-media` | `messages:send` |
| `POST` | `/api/v1/messages/send-template` | `messages:send` |
| `POST` | `/api/v1/messages/send-interactive` | `messages:send` |
| `POST` | `/api/v1/webhooks` | `webhooks:manage` |
| `GET` | `/api/v1/webhooks` | `webhooks:manage` |
| `DELETE` | `/api/v1/webhooks/{id}` | `webhooks:manage` |

Las rutas read-only adicionales son `GET /api/v1/pipelines`,
`GET /api/v1/pipelines/{id}/stages`, `GET /api/v1/deals`,
`GET /api/v1/deals/{id}`, `GET /api/v1/tasks`, las rutas de Flows y las rutas
ERP enumeradas en OpenAPI. Sus scopes son, respectivamente, `pipelines:read`,
`deals:read`, `tasks:read`, `flows:read`, `erp.products:read`,
`erp.inventory:read`, `erp.sales-orders:read` y `erp.invoices:read`.
`PATCH /api/v1/deals/{id}/stage` requiere `deals:write`; no hay otras
escrituras para Pipelines, Deals, Tasks, Flows ni ERP en `0.1.0`. Concede solo
los scopes que realmente necesita SmartBC y no `*` a una integracion normal.

## Webhook recibido por SmartBC

Zinto envia un `POST` HTTPS con cuerpo JSON y estos nombres canonicos de header
(los nombres de headers HTTP no distinguen mayusculas):

```http
Content-Type: application/json
X-Zinto-Event-Id: 550e8400-e29b-41d4-a716-446655440000
X-Zinto-Timestamp: 1786582800
X-Zinto-Signature: v1=<64 caracteres hexadecimales en minuscula>
```

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "message.created",
  "schema_version": 1,
  "occurred_at": "2026-08-13T01:00:00.000Z",
  "data": {
    "id": "701",
    "conversation_id": "88",
    "direction": "incoming",
    "type": "text",
    "content": "Hola",
    "status": "received",
    "created_at": "2026-08-13T01:00:00.000Z"
  }
}
```

La firma es exactamente:

```text
v1=hex(HMAC_SHA256(webhook_secret, timestamp + "." + raw_http_body))
```

Usa el secreto `whsec_...` completo, verifica el cuerpo HTTP sin modificar antes
de parsearlo, comprueba que el ID del header coincide con `body.id`, rechaza
timestamps fuera de cinco minutos y deduplica por ID. Responde `2xx` solo
despues de persistir el evento. Zinto reintenta timeouts y respuestas no `2xx`;
la entrega es al menos una vez y no garantiza orden global.

## Eventos de `0.1.0`

La migracion de eventos instala captura para todas las familias enumeradas en
OpenAPI: CRM, deals, pipelines y etapas, tareas, ERP operativo y Flows. Los
triggers de familias opcionales se crean solo cuando existe su tabla de origen.
Los comodines usados en la documentacion son abreviaturas; SmartBC debe enviar
uno de los valores completos de `WebhookEventType` al crear la suscripcion.

Un mensaje entrante y uno saliente usan `message.created`; SmartBC debe mirar
`data.direction` (`incoming` u `outgoing`) en vez de esperar un evento separado
`message.received`.

Un cambio de etapa emite `deal.stage.changed` en lugar de `deal.updated`, y la
primera transicion de una tarea a completada emite `task.completed`. Que estas
familias tengan eventos no implica que dispongan de endpoints CRUD publicos en
`0.1.0`; SmartBC debe usar solo las rutas incluidas en OpenAPI.

## Compatibilidad hacia atras

- No se elimina ni renombra ninguna ruta, scope, header o evento aceptado.
- Los IDs se serializan como strings aunque la base de datos use enteros.
- Los cursores son opacos; SmartBC solo debe reenviar `meta.next_cursor`.
- Los campos nuevos en respuestas o `data` de eventos deben tolerarse.
- Los errores se deciden por `error.code`, no por el texto humano.
- Un `504 delivery_timeout` es ambiguo: reconcilia historial/webhook antes de
  decidir si reintentas con una nueva clave de idempotencia.
