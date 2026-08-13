# Errores

Los errores usan un formato estable:

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request body is invalid",
    "request_id": "req-123"
  }
}
```

Conserva `request_id` al informar una incidencia. El codigo HTTP indica la
categoria y `error.code` permite decisiones automaticas.

| HTTP | Codigos frecuentes | Accion recomendada |
| --- | --- | --- |
| 400 | `validation_error`, `idempotency_key_required` | Corregir la solicitud |
| 401 | `missing_api_key`, `invalid_api_key`, `api_key_expired` | Revisar o rotar la clave |
| 403 | `insufficient_scope`, `ip_not_allowed` | Ajustar permisos o IPs |
| 404 | `*_not_found` | Verificar ID y empresa |
| 409 | `idempotency_conflict`, `channel_inactive` | No repetir sin corregir |
| 422 | `channel_capability_unsupported` | Elegir otro canal o tipo |
| 502 | `delivery_rejected` | El motor legacy rechazo la solicitud (su propio 4xx); no reintentar sin cambiarla |
| 502 | `delivery_failed` | Motor legacy caido o respuesta inesperada; reintentar con la misma clave cuando corresponda |
| 504 | `delivery_timeout` | Verificar estado antes de reintentar |
| 500 | `internal_error` | Reintentar con espera y comunicar `request_id` |

No programes la integracion contra el texto de `message`; usa `code`.

