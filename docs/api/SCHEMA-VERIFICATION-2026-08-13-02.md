# Verificación de esquema real — segunda pasada (13 de agosto de 2026)

Inspección de solo lectura en un staging aislado nuevo (mismo procedimiento de
`STAGING-REPORT-2026-08-13.md` sección 7.1: backup verificado por checksum,
restaurado, inspeccionado, contenedor y volumen destruidos al terminar — nunca
tocó producción). Objetivo: cerrar el riesgo abierto que dejó documentado el
bloque de `deal.stage.changed`, y reunir evidencia real de esquema para el
siguiente bloque de trabajo antes de que ningún agente asuma nada por su
cuenta.

---

## 1. `deal_activities` — riesgo cerrado

```
Column     | Type    | Nullable | Default
-----------+---------+----------+---------------------------------
id         | integer | not null | nextval('deal_activities_id_seq')
deal_id    | integer | not null |
user_id    | integer | not null |
type       | text    | not null |
content    | text    | not null |
metadata   | jsonb   |          |
created_at | timestamp | not null | now()
FK: deal_id -> deals(id) ON DELETE CASCADE
FK: user_id -> users(id) ON DELETE CASCADE
```

Exactamente las 6 columnas que ya asumía el `INSERT` de
`src/resources/pipeline-mutations.ts` (`deal_id, user_id, type, content,
metadata, created_at`), sin ninguna columna `NOT NULL` adicional no
contemplada. `id` y `created_at` tienen `DEFAULT`; `metadata` es nullable. El
`INSERT` tal como está escrito es correcto contra el esquema real. **Riesgo
cerrado** — se actualiza el comentario `RIESGO ABIERTO` en el código para
reflejarlo.

Nota colateral: `user_id` tiene FK a `users(id)`, así que el `userId` de la
API key usada siempre debe corresponder a una fila real de `users` — ya es el
caso hoy (`api_keys.user_id` es `NOT NULL` con la misma FK).

---

## 2. `conversations` — sin restricción única en `(contact_id, channel_id)`

Confirmado con `\d conversations` completo: existe el índice no-único
`idx_conversations_contact_channel btree (contact_id, channel_id)`, pero
**ninguna** restricción `UNIQUE` sobre esas columnas. Además:

- `check_conversation_type`: `(is_group = false AND contact_id IS NOT NULL
  AND group_jid IS NULL) OR (is_group = true AND contact_id IS NULL AND
  group_jid IS NOT NULL)` — una conversación 1:1 exige `contact_id`, una
  grupal lo prohíbe.
- `company_id` es nullable en el esquema (igual que en `pipelines`), pero sin
  filas nulas hoy — mismo patrón de cautela que ya se aplica en
  `pipelines`/`pipeline_stages`.

**Implicación para un futuro endpoint de "crear o encontrar conversación por
contacto+canal sin duplicados" (Bloque 4, pendiente):** un `SELECT` seguido de
un `INSERT` condicional dentro de una transacción **no es suficiente** —dos
peticiones concurrentes con el mismo `contact_id`+`channel_id` pueden pasar
ambas el `SELECT` antes de que la otra haga `COMMIT` del `INSERT`, y crear dos
conversaciones duplicadas para el mismo contacto y canal. No hay una
restricción `UNIQUE` en la que apoyarse para un `INSERT ... ON CONFLICT`.

La solución correcta sin tocar el esquema existente (no se va a añadir un
índice único a una tabla del CRM compartido sin decisión explícita del
propietario, ya que otras rutas del motor legacy insertan en esta tabla sin
pasar por nuestro código y podrían violarlo) es un **advisory lock de
Postgres** (`pg_advisory_xact_lock(hashtext(contact_id::text || ':' ||
channel_id::text))`) al principio de la transacción, antes del `SELECT`: dos
peticiones concurrentes con la misma pareja se serializan por el lock, la
segunda ve ya creada la fila de la primera cuando le toca su turno. Se libera
solo al `COMMIT`/`ROLLBACK`. Este es el detalle que se le da ya resuelto al
agente que implemente ese endpoint, para que no improvise ni proponga un
índice único nuevo sobre una tabla que no es nuestra.

---

## 3. `contact_tasks.assigned_to` — confirmado texto libre, sin poder validarse

```
assigned_to | text | (nullable, sin FK)
```

Valores reales observados en producción (2 filas del dataset actual):
`Isabel.ruston@bcousinoprop.com` (un email) y `sofia` (un nombre de pila, sin
dominio ni formato consistente). Confirma lo que ya advertía
`NEXT-PHASE-PLAN-2026-08-13.md`, Bloque 4, Trampa 3: no hay un formato único
que resolver contra `users` (ni email consistente, ni username, ni id
numérico). **Sigue siendo una decisión del propietario**, no algo que este
bloque vaya a resolver unilateralmente: o se intenta una resolución best-effort
por email/nombre (con el riesgo de falsos negativos dado lo visto aquí), o se
documenta explícitamente en el contrato de la API que el campo es de texto
libre y la API no garantiza que el asignado exista. No se implementa ninguna
de las dos opciones sin esa decisión.

---

## 4. `messages.external_id` — índice no único

`idx_messages_external_id btree (external_id) WHERE external_id IS NOT NULL`
existe, pero tampoco es `UNIQUE`. Relevante si se implementa un endpoint de
reconciliación de mensajes por `external_id` del proveedor: puede haber, en
teoría, más de una fila con el mismo valor (aunque en la práctica el
proveedor debería garantizar unicidad) — cualquier lectura por `external_id`
debe devolver una lista o la más reciente explícitamente, nunca asumir
`LIMIT 1` sin `ORDER BY` determinista.

---

## Resumen de lo que queda listo para el siguiente bloque

- `deal_activities`: cerrado, sin acción pendiente.
- `conversations`: patrón de bloqueo (advisory lock) especificado para quien
  implemente creación/deduplicación de conversaciones.
- `contact_tasks.assigned_to`: confirmado como decisión pendiente del
  propietario, no una tarea de ingeniería a resolver por su cuenta.
- `messages.external_id`: no asumir unicidad en ningún endpoint nuevo que lo
  use como clave de búsqueda.
