# Idempotencia y reintentos

Las creaciones y los envios que pueden duplicar efectos requieren:

```http
Idempotency-Key: <identificador unico de hasta 255 caracteres>
```

Genera una clave nueva por operacion logica, por ejemplo un UUID. Si una
solicitud se pierde, repite exactamente el mismo metodo, ruta, cuerpo y clave.
Zinto devuelve la respuesta guardada y agrega:

```http
Idempotent-Replayed: true
```

Reutilizar la clave con otro cuerpo produce `409 idempotency_conflict`.

## Regla especial para timeout de entrega

Un `504 delivery_timeout` significa que el resultado del proveedor es
desconocido. No generes otra clave ni reintentes automaticamente. Primero
consulta la conversacion o espera el webhook para verificar si el mensaje fue
aceptado. Repetir con una clave nueva podria duplicarlo.

## Operaciones que exigen la clave

- `POST /api/v1/contacts`
- `POST /api/v1/contacts/{id}/notes`
- todos los endpoints `POST /api/v1/messages/*`

