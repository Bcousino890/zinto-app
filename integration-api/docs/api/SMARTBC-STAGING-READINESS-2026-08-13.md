# Readiness de staging para SmartBC

## Orden seguro

1. Crear backup restaurable de la base de datos y registrar checksum.
2. Restaurar el backup en una base aislada sin datos de clientes nuevos.
3. Aplicar `001_integration_api.sql`, `002_performance_indexes.sql`, `003_webhook_lease_tokens.sql`, `004_task_outbox_events.sql` y `005_pipeline_deal_outbox_events.sql` en orden.
4. Confirmar existencia de tablas, indices, funciones y triggers; verificar que cada trigger omite `zinto.integration_api_origin = 'api'`.
5. Ejecutar suite, pruebas de aislamiento y una prueba de rollback/restauracion.
6. Generar una clave de prueba exclusiva y habilitar solo la empresa piloto.
7. Ejecutar E2E con `+34 606806103` y `+56 9 91653343`.

## Condiciones de parada

- No aplicar `005` si `pipelines`, `pipeline_stages.pipeline_id` o `deals.pipeline_id` no existen.
- No abrir escrituras si `api_keys.permissions`, allowlists o `company_id` no estan verificados.
- No habilitar media de terceros si la descarga sigue pasando por el cliente legacy sin pinning.
- No usar numeros de clientes reales para el E2E.

## Produccion

Este documento no autoriza migraciones ni despliegue. La activacion requiere backup confirmado, ventana operativa, verificacion posterior y rollback preparado.
