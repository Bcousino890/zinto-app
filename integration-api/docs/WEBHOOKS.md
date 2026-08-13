# Webhooks bidireccionales

Los webhooks notifican cambios producidos en Zinto, incluidos mensajes
entrantes, actualizaciones realizadas desde el CRM y cambios generados por la
API. La URL debe ser HTTPS y no puede apuntar directamente a localhost ni a una
direccion IP.

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

