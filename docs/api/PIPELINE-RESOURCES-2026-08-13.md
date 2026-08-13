# Recursos de lectura: pipelines, etapas, deals y tareas

Fecha: 13 de agosto de 2026
Estado: **implementado, solo lectura, 62 pruebas propias**
Continúa `docs/api/NEXT-PHASE-PLAN-2026-08-13.md` (Bloque 4).

## Alcance

Solo `GET`. Ninguna ruta escribe. El motivo sigue siendo el mismo del plan
anterior: `deals.stage` y `deals.stage_id` son vocabularios distintos y en los
513 deals reales nunca coinciden, así que escribir el cambio de etapa por
adivinación corrompería datos reales. Ese punto queda para cuando se observe el
compilado en staging (ver `LEGACY-ENGINE-AUDIT-2026-08-13.md`).

## Rutas y scopes

| Ruta | Scope | Nota |
| --- | --- | --- |
| `GET /api/v1/pipelines` | `pipelines:read` | `updated_since` para reconciliación |
| `GET /api/v1/pipelines/:id/stages` | `pipelines:read` | 404 si el pipeline no es de la empresa |
| `GET /api/v1/deals` | `deals:read` | filtros opcionales `pipeline_id`, `contact_id` |
| `GET /api/v1/deals/:id` | `deals:read` | 404 si no es de la empresa |
| `GET /api/v1/tasks` | `tasks:read` | filtro opcional `contact_id` |

## Decisiones de modelado

### Las dos columnas de etapa se exponen separadas, nunca fusionadas

`Deal.stage_key` es el texto heredado (`lead`, `qualified`, `closed_won`,
`closed_lost`). `Deal.stage_id` y `Deal.stage_name` son la etapa configurable.
Un consumidor que solo mire `stage_name` debe poder distinguir "sin etapa
configurable asignada" (`null`) de "hay una etapa pero no se pudo resolver".

`stage_name` se resuelve con un `LEFT JOIN` acotado **a la vez** por
`pipeline_id` y `company_id` del propio deal:

```sql
LEFT JOIN pipeline_stages
       ON pipeline_stages.id = deals.stage_id
      AND pipeline_stages.pipeline_id = deals.pipeline_id
      AND pipeline_stages.company_id = deals.company_id
```

Consecuencia deliberada: si `stage_id` apunta a una etapa que existe pero
pertenece a *otro* pipeline o a otra empresa, `stage_name` sale `null` en lugar
de mostrar el nombre de una etapa ajena. Cubierto por prueba.

### `company_id` nullable en `pipelines` y `pipeline_stages`: filtro siempre estricto

Ninguna consulta usa `OR company_id IS NULL`. El día que existan plantillas
globales, deben exponerse por un recurso distinto y explícito, nunca mezcladas
en el listado de la empresa por un filtro permisivo.

### Etapas: pertenencia doble

`listStages` exige que el pipeline sea de la empresa (comprobación previa,
devuelve `404 pipeline_not_found` si no) y además que cada etapa devuelta
cumpla `pipeline_stages.company_id = $2 AND pipeline_stages.pipeline_id = $1`.
Comprobar solo una de las dos permitiría confundir IDs entre empresas si algún
día los IDs de pipeline no fueran únicos globalmente.

### `contact_tasks.assigned_to` se expone tal cual, como texto libre

No se intenta resolver contra usuarios porque la columna no es una referencia
validada. El campo se documenta explícitamente como texto libre en el esquema
OpenAPI para que un integrador no asuma que es un ID.

## Reutilización

`cursorParameters`, `iso` y `paged` de `src/resources/core.ts` se exportaron
para reutilizarse aquí en vez de duplicar la lógica de cursor. Es el único
cambio a un archivo fuera del alcance nuevo.

## Pruebas

62 casos nuevos entre `test/pipeline-repository.test.ts` (9, contra un pool de
Postgres de prueba) y `test/pipeline-resources.test.ts` (53, HTTP con
repositorios en memoria). Cubren:

- aislamiento: ID de otra empresa en cada ruta devuelve 404 o lista vacía;
- un pipeline de otra empresa no permite listar sus etapas;
- una etapa que pertenece a otro pipeline no se devuelve aunque el ID exista;
- cursor: límites, cursor inválido, empate de timestamps, página final;
- `updated_since`: filtra y mantiene orden estable;
- los dos campos de etapa se exponen por separado, nunca fusionados.

## Qué añadir a OpenAPI

Ya incorporado en `integration-api/openapi/openapi.yaml`: las cinco rutas, el
parámetro `updated_since`, y los esquemas `Pipeline`, `PipelineStage`, `Deal`
(con `stage_key` documentado como vocabulario distinto de `stage_id`/
`stage_name`) y `Task` (con `assigned_to` documentado como texto libre).

## Siguiente paso

La escritura de estos recursos depende del hallazgo de
`LEGACY-ENGINE-AUDIT-2026-08-13.md` sobre qué columna(s) lee y escribe el CRM
compilado al cambiar de etapa. No implementar `PATCH` de deals sin eso resuelto.
