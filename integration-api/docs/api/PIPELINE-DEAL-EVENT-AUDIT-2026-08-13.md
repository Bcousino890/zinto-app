# Auditoria de eventos CRM para pipelines, stages y deals

Fecha: 2026-08-13  
Alcance: solo lectura; no se implementaron CRUD, no se modifico el VPS y no se aplico SQL.

## Resumen ejecutivo

El respaldo local confirma que el CRM tiene tablas y reglas de integridad para `pipelines`, `pipeline_stages` y `deals`, pero no contiene triggers de outbox para publicar cambios de esas entidades a integradores externos.

En el codigo actual de `integration-api`:

- Los cambios de deal hechos mediante el endpoint API de etapa escriben auditoria y outbox de forma explicita dentro de la misma transaccion.
- No existe un trigger que capture cambios de pipelines, stages o deals originados directamente por el CRM compilado.
- Por tanto, la bidireccionalidad de esas tres familias no esta completa para cambios CRM-originados. Un partner puede recibir el cambio de etapa hecho por la API, pero no un cambio equivalente hecho desde la UI o desde otro proceso del CRM.
- El mecanismo existente para evitar duplicados es `zinto.integration_api_origin = 'api'`: los triggers CRM-originados deben ignorar las escrituras de la API, mientras que las mutaciones API deben seguir creando un unico evento propio.

## Fuentes revisadas

### Codigo actual

- `migrations/001_integration_api.sql`
- `migrations/004_task_outbox_events.sql`
- `src/resources/pipeline-mutations.ts`
- `src/resources/pipelines.ts`
- `src/routes/pipeline-mutations.ts`
- pruebas de repositorio, aislamiento y outbox relacionadas con pipelines/deals.

### Respaldo local

- `/Users/benjamincousino/Documents/ChatGPT/zinto-app-github-backup-upload/migrations/001-initial-schema.sql`
- `/Users/benjamincousino/Documents/ChatGPT/zinto-app-github-backup-upload/migrations/112_add_multi_pipeline_support.sql`
- `/Users/benjamincousino/Documents/ChatGPT/zinto-app-github-backup-upload/migrations/119_fix_company_pipeline_stages_trigger.sql`
- `/Users/benjamincousino/Documents/ChatGPT/zinto-app-github-backup-upload/migrations/149-pipeline-ownership-and-agent-assignments.sql`

El respaldo local se usa como evidencia del esquema historico disponible, no como prueba de que cada objeto siga igual en la base de produccion. La verificacion contra produccion queda pendiente y no se intento en esta auditoria.

## Hallazgos verificables

### H1. No existe captura CRM-originada para pipelines, stages o deals

`migrations/001_integration_api.sql` crea funciones y triggers para:

- `contacts` -> contactos y tags.
- `notes` -> notas.
- `conversations` -> conversaciones.
- `messages` -> mensajes y cambios de estado.
- `channel_connections` -> cambios de estado del canal.

El archivo no define funciones ni triggers para `pipelines`, `pipeline_stages` o `deals`. La migracion `004_task_outbox_events.sql` agrega exclusivamente `contact_tasks`.

Resultado: un `INSERT`, `UPDATE` o `DELETE` ejecutado por el CRM sobre esas tres entidades no genera actualmente una fila de `integration_api_outbox` por trigger, segun el codigo SQL disponible.

### H2. La API si publica su propio cambio de etapa

`src/resources/pipeline-mutations.ts` configura `zinto.integration_api_origin = 'api'` al abrir la transaccion. Luego `changeDealStage`:

1. Comprueba que el deal pertenece a la empresa solicitante.
2. Comprueba que el stage pertenece a la empresa y al pipeline correcto.
3. Actualiza `deals.stage_id` y `deals.stage` juntos.
4. Escribe `deal_activities`.
5. Escribe `integration_api_audit_records` e `integration_api_outbox` mediante `record`.

Esto cubre el evento producido por esa ruta API, pero no sustituye un trigger para cambios externos a la API. El `origin=api` es necesario para que, al añadir el trigger, una misma operacion no produzca dos eventos.

### H3. El respaldo tiene integridad de pertenencia, no sincronizacion de eventos

En `001-initial-schema.sql`:

- `pipeline_stages` tiene `company_id` nullable y no tiene `pipeline_id` en la definicion inicial.
- `deals` tiene `company_id`, `stage_id` y el enum textual `stage`.
- `check_deal_stage_company_match()` impide que `deals.stage_id` apunte a un stage de otra empresa.
- `trigger_check_deal_stage_company_match` aplica esa funcion antes de insertar o actualizar un deal.

Esta regla valida integridad del dato, pero no crea un evento de webhook ni un registro en `integration_api_outbox`.

### H4. La migracion multi-pipeline cambia la forma de pertenencia

`112_add_multi_pipeline_support.sql`:

- Crea `pipelines`.
- Agrega `pipeline_stages.pipeline_id` con FK a `pipelines`.
- Agrega `deals.pipeline_id` con FK a `pipelines` y `ON DELETE RESTRICT`.
- Migra stages y deals a pipelines por empresa.
- Declara `pipeline_stages.pipeline_id` y `deals.pipeline_id` como `NOT NULL` despues de la migracion.
- Crea unicidad de orden por pipeline y unicidad de nombre de pipeline por empresa para pipelines no plantilla.

El mismo archivo indica que la comprobacion cruzada de stage y pipeline se deja a la aplicacion. No incorpora triggers de eventos ni un outbox.

### H5. La migracion 119 elimina un trigger legacy de creacion de stages

`119_fix_company_pipeline_stages_trigger.sql` elimina:

- `trigger_create_company_pipeline_stages` sobre `companies`.
- `create_company_pipeline_stages()`.
- `create_default_pipeline_stages(INTEGER)`.

La razon documentada es evitar que el trigger antiguo cree stages sin `pipeline_id` despues de hacer obligatorio ese campo. Esto es una correccion de inicializacion e integridad, no un mecanismo de sincronizacion de eventos.

### H6. La migracion 149 agrega autoria y asignaciones, pero no eventos

`149-pipeline-ownership-and-agent-assignments.sql`:

- Agrega `pipelines.created_by`.
- Crea `pipeline_agent_assignments`.
- Usa claves foraneas compuestas para mantener empresa, pipeline y usuario en el mismo tenant.

No define triggers sobre pipelines, stages, deals ni inserciones en `integration_api_outbox`. Si estas operaciones deben sincronizarse con terceros, necesitaran cobertura adicional.

### H7. El contrato de payload no puede copiarse del respaldo sin fijar una version

El respaldo muestra columnas distintas entre la definicion inicial y la migracion multi-pipeline, y el codigo actual expone campos adicionales de deals como `custom_fields`, `stage_name`, `last_activity_at` y `assigned_to_user_id`. Por ello no es seguro construir un trigger usando `ROW` completo o asumir que todas las columnas existen en produccion.

Antes de crear la migracion de eventos hay que verificar en la base real:

- columnas actuales de las cuatro tablas.
- tipo real de `id`, `company_id`, `pipeline_id`, `stage_id` y fechas.
- existencia y forma de `integration_api_outbox`.
- existencia de triggers previos con nombres legacy.
- forma actual de `deal_activities`.

## Estado actual por origen

| Entidad | Cambio desde API | Cambio desde CRM/UI | Evento outbox por trigger | Estado |
|---|---:|---:|---:|---|
| Pipeline | No hay CRUD completo en esta auditoria | No auditado por evento | No | Pendiente |
| Pipeline stage | Cambio de etapa de deal publica evento API; CRUD no auditado aqui | No | No | Parcial |
| Deal | `PATCH /deals/{id}/stage` publica evento API | No | No | Parcial |
| Tarea | Mutaciones API y trigger CRM existen en `004_task_outbox_events.sql` | Si | Si | Referencia de diseño |

## Diseño de migracion pendiente

No se implementa en esta tarea. El siguiente cambio deberia ser una migracion aditiva, por ejemplo `005_pipeline_deal_outbox_events.sql`, despues de verificar el esquema real.

### Funcion compartida

Crear una funcion por entidad o una funcion cuidadosamente separada por tabla, con estas propiedades:

1. Leer `current_setting('zinto.integration_api_origin', true)` y retornar sin emitir si el valor es `api`.
2. Obtener `company_id` exclusivamente de la fila afectada o de una relacion estrictamente tenant-safe.
3. No usar `company_id IS NULL` como fallback para publicar eventos.
4. Emitir en la misma transaccion que el cambio del CRM.
5. Usar `COALESCE(NEW, OLD)` solo despues de elegir explicitamente los campos validos para `INSERT`, `UPDATE` y `DELETE`.
6. Nunca incluir secretos, tokens o datos que no formen parte del contrato publico.

### Eventos recomendados

Los nombres son una propuesta y deben congelarse en OpenAPI y en la documentacion antes de aplicarlos:

- `pipeline.created`, `pipeline.updated`, `pipeline.deleted`.
- `pipeline_stage.created`, `pipeline_stage.updated`, `pipeline_stage.deleted`.
- `deal.created`, `deal.updated`, `deal.deleted`.
- `deal.stage.updated` cuando cambien `stage_id` o `stage`.
- `deal.pipeline.updated` cuando cambie `pipeline_id`.

Si un `UPDATE` cambia pipeline y stage en una sola sentencia, se debe emitir un unico evento de cambio de deal con ambos valores finales, o definir expresamente eventos separados y probar el orden. No se debe producir una cascada ambigua.

### Payload minimo recomendado

Cada evento deberia incluir `id`, `company_id` solo si el contrato lo permite, `created_at`, `updated_at` y los campos modificados o el snapshot final versionado. Para deals se deben incluir conjuntamente `pipeline_id`, `stage_id` y `stage`, porque el CRM mantiene ambos vocabularios y no son intercambiables.

El evento debe conservar `resource_type`, `resource_id`, `event_type` y `schema_version` en las columnas existentes de `integration_api_outbox`. La entrega posterior debe seguir filtrando por empresa y por suscripcion del partner.

### Interaccion con mutaciones API

Las mutaciones API actuales ya escriben outbox explicitamente. Al instalar triggers CRM-originados:

- API: `origin=api` -> trigger omitido -> una fila outbox explicita.
- CRM/UI: sin `origin=api` -> trigger -> una fila outbox.
- Otro proceso interno: sin `origin=api` -> trigger, si el cambio debe considerarse CRM-originado.

Debe evitarse cambiar el nombre o semantica del ajuste de sesion sin revisar todas las transacciones existentes.

## Pruebas pendientes

### Pruebas SQL contra una copia restaurable

- `INSERT`, `UPDATE` y `DELETE` de pipeline producen exactamente un evento cada uno.
- `INSERT`, `UPDATE` y `DELETE` de stage producen exactamente un evento cada uno.
- Crear deal produce `deal.created` con pipeline y stage coherentes.
- Editar campos no relacionados produce `deal.updated`.
- Cambiar solo `stage_id` produce el evento de cambio de stage definido.
- Cambiar solo `pipeline_id` produce el evento de cambio de pipeline definido.
- Cambiar pipeline y stage juntos no duplica ni deja valores cruzados.
- Borrar un deal produce evento antes de que las referencias en cascada eliminen actividad relacionada.
- Cambios con `company_id` nulo no publican eventos.
- Un stage de otra empresa es rechazado por las reglas existentes.
- Un deal de otra empresa no crea ningún evento visible para la empresa atacante.

### Pruebas de no duplicacion

- Mutacion API de etapa: una fila outbox, no dos.
- Mutacion API que llegue a trigger de integridad: el trigger de eventos debe seguir omitido por `origin=api`.
- Reintento idempotente: misma respuesta y ninguna fila outbox adicional.
- Cambio CRM seguido de entrega: el partner recibe un solo evento con `event_id` estable.

### Pruebas de contrato

- Documentar todos los nuevos `event_type` en `docs/api/WEBHOOKS.md` y OpenAPI.
- Verificar que el payload no expone columnas internas, secretos ni datos de otra empresa.
- Verificar que la version de schema permanece estable ante columnas opcionales ausentes.
- Probar filtros por `event_types` y rechazo de tipos no documentados, si el contrato los restringe.

### Pruebas operativas

- Aplicacion en staging restaurado, con checksum del backup antes y despues.
- Verificacion de triggers existentes y de nombres legacy antes de `CREATE OR REPLACE`.
- Prueba de rollback o procedimiento de desactivacion del trigger.
- Medicion de latencia e impacto de cada trigger bajo inserciones/actualizaciones en lote.
- Verificacion posterior de que el CRM sigue creando pipelines y stages correctamente tras la eliminacion del trigger legacy de la migracion 119.

## Bloqueos y proxima accion segura

El bloqueo no es de diseño conceptual, sino de evidencia del esquema real y de contrato. No se debe aplicar una migracion de eventos basada solo en los cuatro archivos del respaldo, porque esos archivos describen una evolucion historica y no garantizan que la base activa tenga exactamente las mismas columnas y restricciones.

La proxima accion segura es una inspeccion read-only del esquema y triggers en staging o produccion autorizada, seguida de una migracion nueva con pruebas SQL de no duplicacion y aislamiento multiempresa. Esta auditoria no ha cambiado el VPS, no ha aplicado SQL y no ha creado CRUD.
