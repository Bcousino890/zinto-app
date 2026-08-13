# Eventos CRM de pipelines, stages y deals

`005_pipeline_deal_outbox_events.sql` captura cambios directos del CRM en `integration_api_outbox` dentro de la misma transaccion.

Debe aplicarse despues de `001_integration_api.sql` y de la migracion multi-pipeline que crea `pipelines` y añade `pipeline_id` a stages y deals. Las transacciones de la API establecen `zinto.integration_api_origin=api`, por lo que los triggers omiten esas escrituras y evitan duplicados.

Publica eventos `pipeline.*`, `pipeline_stage.*`, `deal.*`, y clasifica cambios de deal como `deal.stage.updated` o `deal.pipeline.updated`. Los payloads son snapshots explicitos y los deletes usan `OLD`. Los cambios sin `company_id` no publican eventos.

Las pruebas incluidas son de contrato SQL. Antes de aplicarla en produccion se debe ejecutar en staging restaurable y verificar que las columnas opcionales del esquema real coinciden.
