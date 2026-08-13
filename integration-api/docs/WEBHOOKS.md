# Webhooks bidireccionales

Los webhooks notifican cambios producidos en Zinto, incluidos mensajes
entrantes, actualizaciones realizadas desde el CRM y cambios generados por la
API. La URL debe ser HTTPS y no puede apuntar directamente a localhost ni a una
direccion IP.

Registrar o desactivar webhooks cuenta como escritura. Por eso, si
`READ_ONLY_MODE=true`, estas operaciones siguen cerradas salvo que la clave API
o su empresa esten autorizadas explicitamente en la allowlist operativa del
servidor. `GET /api/v1/webhooks` sigue disponible como lectura normal para
claves con `webhooks:manage`.

## Crear un endpoint

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $ZINTO_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "url": "https://integracion.example.com/webhooks/zinto",
    "event_types": ["message.created", "contact.updated"]
  }' \
  https://crm.zinto.app/_integration-api/api/v1/webhooks
```

La respuesta contiene un secreto `whsec_...` que solo se entrega al crear el
endpoint. Guardalo en un gestor de secretos.

## Formato del evento

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "message.created",
  "schema_version": 1,
  "occurred_at": "2026-08-13T01:00:00.000Z",
  "data": {}
}
```

Encabezados:

```http
X-Zinto-Event-Id: 550e8400-e29b-41d4-a716-446655440000
X-Zinto-Timestamp: 1786582800
X-Zinto-Signature: v1=<hex hmac sha256>
```

La firma se calcula sobre la cadena exacta
`<timestamp>.<cuerpo HTTP sin modificar>` usando HMAC-SHA256. Verifica la firma
antes de parsear o procesar el JSON. Rechaza timestamps fuera de una tolerancia
razonable, por ejemplo cinco minutos, y registra cada ID de evento para ignorar
duplicados.

## Entrega y reintentos

- Responde con cualquier estado `2xx` solo despues de guardar el evento.
- El receptor debe completar rapido y procesar en segundo plano.
- Zinto usa un timeout de 15 segundos.
- Los fallos se reintentan con espera exponencial hasta 10 intentos.
- El mismo evento puede entregarse mas de una vez.
- El orden global entre eventos no esta garantizado.

El ejemplo `examples/webhook-receiver.ts` incluye verificacion de firma y
proteccion basica contra replay.

## Comportamientos multi-evento (por diseno)

Dos casos, confirmados en `docs/api/STAGING-REPORT-2026-08-13.md` seccion 4,
producen mas de un evento por una sola operacion en el CRM. Ninguno de los dos
es un error: un consumidor que asuma "una operacion = un evento" se sorprendera
con ambos, asi que quedan documentados aqui de forma explicita.

**1. Un mensaje entrante puede llegar junto con `conversation.updated`.** La
tabla `messages` ya tenia, antes de esta integracion, un trigger propio del CRM
que actualiza `conversations.unread_count` y `last_message_at` cuando llega un
mensaje con `direction=inbound`. Como el trigger de la Integration API se
dispara ante cualquier `UPDATE` de `conversations` sin filtrar columnas, cada
mensaje entrante nuevo genera **dos** eventos en el outbox: `message.created`
seguido de `conversation.updated`. Los mensajes `outbound` no activan esto,
porque no tocan `unread_count`.

**2. Un cambio de tags genera un evento extra por cada tag.** Un `UPDATE` de
`contacts` que modifica el arreglo `tags` (junto con o sin otros campos)
produce `contact.updated` **mas** un `tag.attached` o `tag.detached` por cada
tag agregado o quitado en esa misma sentencia. Actualizar tres tags en un solo
`UPDATE` produce cuatro eventos, no uno.

En ambos casos, procesa cada evento de forma idempotente por `id` en vez de
asumir una correspondencia 1:1 con la operacion que los origino.
