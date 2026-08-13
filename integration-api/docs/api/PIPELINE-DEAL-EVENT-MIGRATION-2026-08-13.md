# Eventos CRM de pipelines, stages y deals

La migracion `005_pipeline_deal_outbox_events.sql` captura cambios hechos directamente por el CRM y los escribe en `integration_api_outbox` dentro de la misma transaccion.

## Prerrequisitos

Debe aplicarse despues de que existan `integration_api_outbox` (`001_integration_api.sql`), `pipelines`, `pipeline_stages.pipeline_id` y `deals.pipeline_id` (`112_add_multi_pipeline_support.sql`). No se aplica desde la API ni se ejecuta en este cambio.

## Eventos

- `pipeline.created`, `pipeline.updated`, `pipeline.deleted`
- `pipeline_stage.created`, `pipeline_stage.updated`, `pipeline_stage.deleted`
- `deal.created`, `deal.updated`, `deal.deleted`
- `deal.stage.updated` cuando cambia `stage_id` o `stage`
- `deal.pipeline.updated` cuando cambia `pipeline_id`

Cada operacion de una fila produce como maximo un evento. Los payloads son snapshots explicitos de columnas estables del esquema; no usan `ROW` completo ni incluyen columnas opcionales de migraciones posteriores.

## No duplicacion y seguridad

Las transacciones de la API establecen `zinto.integration_api_origin = 'api'` y ya publican su propio evento. Los triggers omiten esas operaciones para evitar duplicados. Los cambios sin `company_id` no publican nada, y los `DELETE` usan la empresa de la fila antigua. Los triggers se recrean con `DROP TRIGGER IF EXISTS` para que una aplicacion repetida no deje triggers duplicados.

Las pruebas asociadas son de contrato SQL/mock: verifican orden de migracion, triggers, aislamiento de tenant, omision API, payload explicito y la clasificacion determinista de cambios de deals. La validacion final debe ejecutarse en un staging restaurable con el esquema real antes de aplicar en produccion.
