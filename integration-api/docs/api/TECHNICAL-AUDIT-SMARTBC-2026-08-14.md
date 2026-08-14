# Auditoria tecnica SmartBC - 2026-08-14

## Alcance

Revision estatica del runtime de `integration-api`, migraciones y pruebas para:

- duplicacion de eventos y outbox;
- contrato de webhooks y entrega;
- tareas y deals;
- Flows y ERP;
- limites y proxy de media.

No se cambio produccion, no se aplicaron migraciones y no se afirmaron capacidades que no esten conectadas en `src/app.ts`.

## Hallazgo corregido

**Alto impacto funcional: doble trigger para tareas.**

`migrations/003_bidirectional_events_outbox.sql` crea `integration_api_tasks_outbox` sobre `contact_tasks`. Posteriormente, `migrations/004_task_outbox_events.sql` creaba `integration_api_contact_tasks_outbox` sin eliminar el trigger anterior. PostgreSQL permite ambos triggers, por lo que una escritura CRM podia encolar dos eventos `task.*` y SmartBC podia procesar dos veces la misma tarea.

Correccion aplicada en `004`: elimina ambos nombres historicos, recrea solo `integration_api_tasks_outbox` y envia el evento mediante `integration_api_enqueue_event`, conservando catalogo, version, metadata de origen y deduplicacion comunes. Se agregaron pruebas de regresion para impedir que vuelva a aparecer el segundo trigger.

**Importante:** esto requiere volver a ejecutar la migracion corregida en una base donde `004` ya se haya aplicado. La migracion es idempotente respecto al trigger, pero no se ejecuto aqui ni en produccion.

## Webhooks

El contrato implementado es de webhooks salientes: `POST /api/v1/webhooks` registra el endpoint y el worker entrega eventos firmados con `v1=HMAC-SHA256(timestamp.raw_body)`, `x-zinto-event-id` y `x-zinto-timestamp`. La entrega tiene leases, reintentos, estado terminal y unicidad `(endpoint_id, outbox_id)`.

La seleccion respeta empresa, endpoint activo, tipos suscritos y `occurred_at >= endpoint.created_at`, evitando inundar a un partner nuevo con historico. No existe un endpoint publico de entrada de eventos desde SmartBC; no debe documentarse como si existiera.

Pendiente operativo: probar contra PostgreSQL real con `INTEGRATION_TEST_DATABASE_URL` y un endpoint autorizado. La suite unitaria cubre firma, aislamiento, reintentos, leases y deduplicacion.

## Tareas y deals

Las rutas de escritura de tareas y deals existen y estan protegidas por scope y allowlist. Las mutaciones usan idempotencia y filtros por `company_id`. `assigned_to` de tareas sigue siendo texto libre; no se puede prometer validacion fuerte de usuario hasta cambiar el esquema o acordar el contrato.

Los triggers CRM deben distinguir escrituras API de escrituras hechas desde el CRM mediante `zinto.integration_api_origin`. La migracion `005` reemplaza los triggers de pipelines, stages y deals con nombres canonicos; la correccion de este informe hace lo mismo para tareas.

## Flows y ERP

Con los repositorios de produccion conectados, `src/app.ts` registra las rutas de `flows.ts` y `erp.ts`; las variantes `flow-reads.ts` y `erp-read.ts` son fallback cuando no se inyecta el repositorio principal. No se registran ambas familias simultaneamente.

Flows expone lectura de flows, detalle, assignments y ejecuciones. ERP expone las rutas realmente conectadas por `erp.ts`: productos, stock-levels, sales-orders e invoices, con detalle donde existe. No se debe prometer escritura de Flows ni ERP, ni lectura de warehouses/suppliers/purchase-orders como parte del runtime principal sin verificar una configuración distinta.

## Media

El proxy descarga la URL con `safe-fetch`, valida DNS/destino, bloquea redirecciones no autorizadas, verifica tipo MIME y limita bytes por categoría: imagen 5 MiB, video/audio 16 MiB y documento 100 MiB por defecto. Después entrega al motor legacy una URL interna del almacenamiento controlado cuando el proxy esta habilitado.

No se encontró un bug seguro adicional. El proxy depende de `MEDIA_PROXY_ENABLED` y `MEDIA_INTERNAL_BASE_URL`; sin esa configuración no debe habilitarse el envío de media a terceros porque el motor legacy podria volver a descargar la URL original.

## Verificacion

Ejecutar antes de integrar o aplicar migraciones:

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

La prueba de PostgreSQL de `test/event-migration.integration.test.ts` se activa solo con `INTEGRATION_TEST_DATABASE_URL`. Debe ejecutarse en staging restaurado antes de repetir `004` en produccion.
