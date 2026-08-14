# Replay y resync de webhooks

Estas operaciones son para personal autorizado de operacion. Ejecutalas primero
en staging, dentro de una transaccion y sustituyendo todos los parametros. Nunca
retires el filtro `company_id`.

## Garantias y limites

- La entrega es at-least-once. El receptor guarda de forma duradera cada
  `X-Zinto-Event-Id` antes de responder `2xx`.
- Un replay conserva el ID original. Si el receptor ya lo proceso, debe seguir
  ignorandolo o habilitar deliberadamente el reprocesado en su propio sistema.
- Un replay requiere que la fila siga en `integration_api_outbox`. No hay una
  politica automatica de retencion en esta entrega.
- La API publica permite reconciliar los recursos de lectura publicados en
  OpenAPI, incluidos pipelines, deals, tareas, Flows y la superficie ERP
  segura. No hay resync HTTP para las familias que siguen fuera de OpenAPI.

## Replay de un evento

La sentencia siguiente crea o reinicia una entrega solo si endpoint y evento
pertenecen a la misma empresa. No interrumpe una entrega `pending`, `retrying` o
`leased`.

```sql
BEGIN;

INSERT INTO integration_api_webhook_deliveries
  (endpoint_id, outbox_id, status, attempt_count, next_attempt_at)
SELECT endpoint.id, outbox.id, 'pending', 0, NOW()
  FROM integration_api_webhook_endpoints endpoint
  JOIN integration_api_outbox outbox
    ON outbox.company_id = endpoint.company_id
 WHERE endpoint.id = :endpoint_id
   AND endpoint.company_id = :company_id
   AND endpoint.active = TRUE
   AND outbox.event_id = :event_id
ON CONFLICT (endpoint_id, outbox_id) DO UPDATE
SET status = 'pending',
    attempt_count = 0,
    next_attempt_at = NOW(),
    lease_expires_at = NULL,
    lease_token = NULL,
    response_status = NULL,
    error_message = NULL,
    delivered_at = NULL,
    updated_at = NOW()
WHERE integration_api_webhook_deliveries.status IN ('delivered', 'dead')
RETURNING endpoint_id, outbox_id, status;

COMMIT;
```

Exige exactamente una fila en `RETURNING`. Cero filas significa parametros
incorrectos, cruce de tenant, endpoint inactivo, outbox purgado o una entrega
que sigue activa; no fuerces una segunda entrega en esos casos.

## Resync desde la fuente de verdad

Para recursos con lectura publica, pagina desde el ultimo cursor confirmado y
aplica upserts por ID en el sistema externo. Los webhooks que lleguen durante el
recorrido se deduplican por ID de evento y se aplican despues del snapshot.

Para recursos sin lectura publica, un operador puede emitir lotes acotados desde
PostgreSQL. Este ejemplo reemite hasta 500 deals activos de una empresa como
`deal.updated`; no inventa una transicion de etapa.

```sql
BEGIN;
SELECT set_config('zinto.integration_api_origin', 'resync', true);

SELECT integration_api_enqueue_event(
         deal.company_id,
         'deal.updated',
         'deal',
         deal.id,
         integration_api_public_payload(to_jsonb(deal)),
         format('resync:%s:deal:%s', :resync_run_id, deal.id)
       ) AS event_id
  FROM deals deal
 WHERE deal.company_id = :company_id
   AND deal.status = 'active'
   AND deal.id > :last_id
 ORDER BY deal.id
 LIMIT 500;

COMMIT;
```

Usa un `resync_run_id` unico por ejecucion y persiste `last_id` despues de cada
lote confirmado. Repetir el mismo lote es seguro: el indice parcial
`(company_id, deduplication_key)` devuelve el evento existente. Un nuevo run ID
crea eventos nuevos, como corresponde a un resync deliberado.

No uses `to_jsonb` generico para Flows. Conserva la misma proyeccion segura de la
migracion y excluye grafo, variables, contexto, rutas de ejecucion y errores.

## Comprobaciones

```sql
-- Lag de outbox por empresa.
SELECT company_id, COUNT(*) AS pending, MIN(occurred_at) AS oldest
  FROM integration_api_outbox
 WHERE processed_at IS NULL
 GROUP BY company_id;

-- Entregas activas o agotadas de un endpoint de la empresa.
SELECT delivery.status, COUNT(*)
  FROM integration_api_webhook_deliveries delivery
  JOIN integration_api_webhook_endpoints endpoint ON endpoint.id = delivery.endpoint_id
 WHERE endpoint.company_id = :company_id
   AND endpoint.id = :endpoint_id
 GROUP BY delivery.status;
```

Antes de cerrar una incidencia, confirma que el lag vuelve a cero, que no crecen
los estados `dead`, que el receptor deduplica IDs repetidos y que una muestra de
payloads pertenece exclusivamente a la empresa seleccionada.
