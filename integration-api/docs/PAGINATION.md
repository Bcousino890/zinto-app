# Paginacion por cursor

Los listados usan cursores opacos para mantener un recorrido estable aunque se
creen nuevos registros durante la sincronizacion.

Parametros:

- `limit`: entre 1 y 200; valor predeterminado 50.
- `cursor`: valor devuelto sin modificar por la pagina anterior.

Ejemplo:

```bash
curl --get --fail-with-body \
  --header "Authorization: Bearer $ZINTO_API_KEY" \
  --data-urlencode 'limit=100' \
  https://crm.zinto.app/_integration-api/api/v1/contacts
```

Respuesta:

```json
{
  "data": [],
  "meta": {
    "request_id": "req-123",
    "next_cursor": "eyJpZCI6IjEyMyIsImNyZWF0ZWRBdCI6Ii4uLiJ9",
    "has_more": true
  }
}
```

Mientras `has_more` sea `true`, realiza la misma llamada con
`cursor=<next_cursor>`. No intentes interpretar ni construir el cursor. Un
cursor invalido devuelve `400 validation_error`.

El historial de una conversacion no se limita al dia actual:

```text
GET /api/v1/conversations/{id}/messages
```

Este endpoint recorre todos los mensajes persistidos de la conversacion.

