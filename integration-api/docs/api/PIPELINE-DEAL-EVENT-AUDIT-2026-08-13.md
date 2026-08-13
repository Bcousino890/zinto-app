# Auditoria de eventos CRM para pipelines, etapas y deals

Fecha: 2026-08-13  
Repositorio auditado: `/Users/benjamincousino/Documents/ChatGPT/zinto-app-write-gating/integration-api`  
Referencia de esquema: respaldo local `/Users/benjamincousino/Documents/ChatGPT/zinto-app-github-backup-upload/migrations/`

## Alcance y evidencia

Esta auditoria compara el codigo actual con estos archivos del respaldo local:

- `001-initial-schema.sql`
- `112_add_multi_pipeline_support.sql`
- `119_fix_company_pipeline_stages_trigger.sql`
- `149-pipeline-ownership-and-agent-assignments.sql`

El respaldo es evidencia de diseno y no sustituye una consulta de solo lectura al esquema actual de produccion. No se ejecutaron migraciones, no se modifico produccion y no se implemento CRUD.

## Hallazgos

### 1. No hay captura CRM-originada para pipelines, stages ni deals

Las migraciones de la Integration API actuales (`001_integration_api.sql` y `004_task_outbox_events.sql`) crean funciones/triggers para:

- `contacts`
- `notes`
- `conversations`
- `messages`
- `channel_connections`
- `contact_tasks`

No hay ninguna funcion ni trigger `integration_api_capture_*` asociado a `pipelines`, `pipeline_stages` o `deals`. Por ello, una modificacion hecha por el CRM compilado no puede producir actualmente eventos como `pipeline.updated`, `stage.updated` o `deal.updated` para un partner.

Esto deja incompleta la bidireccionalidad de esos recursos: las escrituras de la API pueden publicar su propio evento cuando se implementen, pero los cambios originados en el CRM no volveran al partner.

### 2. Las escrituras API existentes no duplican eventos mediante triggers

Los repositorios de mutacion de contactos, conversaciones, tareas y deals ejecutan al inicio de su transaccion:

```sql
SELECT set_config('zinto.integration_api_origin', 'api', true)
```

Las funciones actuales consultan ese valor y retornan sin insertar en `integration_api_outbox` cuando el origen es `api`. Las mutaciones API insertan explicitamente su auditoria y su evento outbox dentro de la misma transaccion.

Resultado verificable: con el diseno actual, una escritura API de esos recursos no debe generar un evento por el trigger y otro por el repositorio. La prueba debe confirmar el conteo exacto de una fila outbox por operacion logica, teniendo en cuenta que cambios de tags pueden generar eventos adicionales intencionales.

### 3. El trigger de tareas sigue el mismo aislamiento y no es duplicador

`004_task_outbox_events.sql` instala `integration_api_contact_tasks_outbox` sobre `contact_tasks`. La funcion:

- ignora filas sin `company_id`;
- ignora transacciones con `zinto.integration_api_origin = 'api'`;
- emite `task.created`, `task.updated`, `task.completed` o `task.deleted` para cambios CRM-originados.

La API, por su parte, inserta `task.*` explicitamente despues de escribir la tarea. Por tanto, el trigger no debe volver a insertar ese mismo evento durante una mutacion API.

### 4. El respaldo confirma una arquitectura multi-pipeline que requiere precondiciones

`001-initial-schema.sql` define `pipeline_stages` y `deals`, pero la tabla `pipelines` y las columnas `pipeline_id` aparecen en `112_add_multi_pipeline_support.sql`. Esa migracion:

- crea `pipelines`;
- agrega `pipeline_stages.pipeline_id` y `deals.pipeline_id`;
- crea claves foraneas a `pipelines`;
- migra pipelines por defecto y filas legacy;
- finalmente fuerza `pipeline_id` a `NOT NULL`;
- crea unicidad de orden de etapas por pipeline y de nombre de pipeline por empresa.

La migracion tambien documenta que la aplicacion debe validar que un deal y su etapa pertenecen al mismo pipeline. No hay un trigger de eventos en esa migracion.

### 5. Existe un trigger legacy incompatible con `pipeline_id NOT NULL`

`119_fix_company_pipeline_stages_trigger.sql` elimina `trigger_create_company_pipeline_stages_on companies` y las funciones legacy que insertaban stages sin `pipeline_id`. Esto es necesario antes de exigir `pipeline_stages.pipeline_id NOT NULL`.

La prueba de migracion debe comprobar que el trigger y las funciones legacy ya no existen, y que crear una empresa no intenta insertar una etapa incompleta. De lo contrario, la siguiente alta de empresa puede fallar despues de la migracion multi-pipeline.

### 6. `created_by` y asignaciones son un bloque de esquema adicional

`149-pipeline-ownership-and-agent-assignments.sql` agrega `pipelines.created_by` y `pipeline_agent_assignments`, con claves foraneas compuestas por `(id, company_id)` para impedir mezclar usuarios, pipelines y empresas.

El CRUD futuro no debe asumir que basta con validar `pipeline_id`: toda lectura o escritura de asignaciones debe filtrar `company_id` y respetar las claves compuestas. Esta migracion tampoco crea eventos outbox.

## Diseno pendiente para eventos CRM-originados

Antes de habilitar escrituras publicas de pipelines/deals, hace falta una migracion separada de eventos, por ejemplo `005_pipeline_deal_outbox_events.sql`, que defina funciones y triggers idempotentes para:

- `pipelines`: `pipeline.created`, `pipeline.updated`, `pipeline.deleted` si el CRM permite borrado;
- `pipeline_stages`: `stage.created`, `stage.updated`, `stage.deleted`;
- `deals`: `deal.created`, `deal.updated`, `deal.deleted`, y un evento explicito para cambio de etapa o pipeline.

La migracion debe:

1. Usar `COALESCE(NEW.company_id, OLD.company_id)` solo cuando el recurso realmente lo permita y rechazar silenciosamente filas sin tenant, sin publicar eventos globales.
2. Leer `current_setting('zinto.integration_api_origin', true)` antes de insertar en outbox.
3. Publicar el payload completo necesario para reconstruir el recurso en un partner, incluyendo `pipeline_id`, `stage_id`, el valor legacy `stage`, `status`, timestamps y `company_id` solo en el contexto interno que corresponda.
4. Diferenciar `deal.stage.changed` de un `deal.updated` generico cuando cambien `stage_id`, `stage` o `pipeline_id`.
5. Evitar eventos parciales: los triggers deben ser `AFTER` y el outbox debe insertarse en la misma transaccion que el cambio CRM.
6. Mantener el contrato de tenant: un `JOIN` o consulta de payload no debe recuperar datos de otra empresa.
7. Instalar los triggers con `DROP TRIGGER IF EXISTS` sobre nombres propios de Integration API, sin eliminar triggers funcionales del CRM salvo que la migracion lo documente explicitamente.

## Pruebas que faltan

No se consideran suficientes las pruebas unitarias de repositorios. Antes de desplegar, deben existir pruebas contra PostgreSQL real, idealmente sobre una copia restaurable del respaldo:

1. `INSERT`, `UPDATE` y `DELETE` CRM-originados de pipelines, stages y deals generan exactamente el evento esperado, con `company_id` correcto.
2. Un `UPDATE deals` que cambie `stage_id` y `stage` produce un evento de cambio de etapa y no un payload con columnas desincronizadas.
3. Un cambio de `pipeline_id` valida que el stage destino pertenece a la misma empresa y al pipeline destino.
4. Una mutacion API con `set_config(..., 'api', true)` genera exactamente el evento escrito por el repositorio y cero eventos adicionales del trigger.
5. Un cambio API de tags conserva los eventos adicionales `tag.attached`/`tag.detached` como comportamiento intencional, sin contarlo como duplicacion.
6. Un `company_id` ajeno o nulo no crea outbox visible para otra empresa.
7. Una empresa nueva no dispara el trigger legacy eliminado por migracion 119 y sus stages se crean con `pipeline_id` valido.
8. El borrado de un pipeline con deals respeta `ON DELETE RESTRICT` y no deja outbox falso de borrado.
9. `created_by`, `pipeline_agent_assignments`, `assigned_by` y sus claves compuestas no permiten cruces entre empresas.
10. Las pruebas de mutacion deben fallar si se elimina temporalmente el predicado de origen API; esto demuestra que la regresion de duplicacion realmente esta cubierta.

## Conclusion

No se encontro un trigger actual que duplique eventos API-originados para los recursos ya cubiertos. La proteccion es consistente: los repositorios marcan el origen API y los triggers existentes lo respetan.

Sin embargo, pipelines, stages y deals todavia no tienen captura CRM-originada. Para completar la bidireccionalidad falta disenar, probar y aplicar una migracion de outbox para esos tres recursos, despues de verificar en el esquema real que `112`, `119` y `149` estan aplicadas y que no existen triggers legacy incompatibles. Hasta cerrar esas pruebas, no debe afirmarse que la API ofrece sincronizacion 100% bidireccional para pipeline/deals.
