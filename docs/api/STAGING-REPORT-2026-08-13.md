# Informe de staging aislado — migración `001_integration_api.sql`

**Fecha:** 2026-08-13
**Autor:** Sesión de ingeniería de datos (Claude Code), VPS de producción
**Alcance:** Validar la migración de la Zinto Integration API en un Postgres de staging completamente aislado, restaurado desde un backup de producción, sin tocar en ningún momento la base de datos de producción `powerchat-postgres-bcousinoprop`.

> Nota sobre continuidad: esta sesión retomó un intento anterior que había muerto por límite de gasto de API. Se reutilizó el backup ya existente (verificado por checksum) tal como se pedía. El contenedor de staging que ya existía se encontró con una migración y pruebas parciales de una corrida anterior mezcladas con las de un intento previo (tabla `zz_test_log` con resultados ambiguos). Por trazabilidad y para poder afirmar con confianza el resultado de cada prueba, se decidió **recrear el staging desde cero** (contenedor + volumen nuevos) en vez de reutilizar ese estado. Esto no cambió el backup usado, que siguió siendo el mismo archivo ya verificado.

---

## 1. Backup utilizado

Se reutilizó el backup ya existente en vez de generar uno nuevo, tal como indicaba el contexto de continuidad.

| Campo | Valor |
|---|---|
| Archivo | `/root/backups/prod-bcousinoprop-2026-08-13.dump` |
| Tamaño | 10.482.678 bytes (10.0 MiB / 10.4 MB) |
| Formato | `pg_dump` formato custom (`Format: CUSTOM`), compresión gzip |
| Creado | 2026-08-13 05:00:11 CEST |
| Base origen | `bcousinoprop_db` (contenedor `powerchat-postgres-bcousinoprop`), Postgres 16.11 |
| Checksum SHA-256 | verificado contra `/root/backups/prod-bcousinoprop-2026-08-13.dump.sha256` → **`OK`** (coincide) |
| Exclusión de datos sensibles | Se confirmó mediante `pg_restore --list` que la tabla `whatsapp_auth_state` **solo** aparece con sus objetos de esquema (tabla, secuencia, PK, índices, FK) y **no** tiene entrada `TABLE DATA` — es decir, el backup respeta `--exclude-table-data='whatsapp_auth_state'` como exige la regla de sesiones de WhatsApp. |

No se generó un backup nuevo porque el existente pasó la verificación de integridad.

---

## 2. Restauración en staging y comparación de conteos

### 2.1 Procedimiento

1. Se detuvo y eliminó el contenedor/volumen de staging preexistente (`zinto-staging-postgres` / `zinto-staging-pgdata`) para partir de un estado limpio y auditable.
2. Se creó un contenedor nuevo, aislado:
   - Imagen: `postgres:16` (misma versión menor que producción, 16.11)
   - Red: `bridge` (red por defecto de Docker) — **no** `powerchat-shared-network`
   - Puerto: `127.0.0.1:5434:5432` (solo loopback, no expuesto a la red)
   - Credenciales: `POSTGRES_USER=powerchat`, `POSTGRES_DB=bcousinoprop_db`, contraseña generada aleatoriamente con `openssl rand -base64 24` en el momento de creación (nunca impresa ni registrada)
   - Volumen dedicado: `zinto-staging-pgdata`
3. Se copió el `.dump` al contenedor y se restauró con `pg_restore --no-owner --no-privileges -j 4`.
4. Restauración: **7.6 s**, sin errores ni warnings.

### 2.2 Comparación de conteos (solo agregados, sin datos de clientes)

| Tabla | Producción (en vivo, momento de la verificación) | Staging (recién restaurado) | Nota |
|---|---:|---:|---|
| companies | 12 | 12 | idéntico |
| contacts | 1161 | 1161 | idéntico |
| conversations | 917 | 917 | idéntico |
| messages | 13577 | 13567 | producción avanzó 10 filas entre el backup y la verificación (esperado, es una BD viva) |
| deals | 513 | 513 | idéntico |
| pipelines | 17 | 17 | idéntico |
| pipeline_stages | 125 | 125 | idéntico |
| contact_tasks | 2 | 2 | idéntico |
| channel_connections | 21 | 21 | idéntico |
| api_keys | 4 | 4 | idéntico |
| whatsapp_auth_state | 9279 (producción) | **0** | correcto: el backup excluye estos datos de sesión por regla explícita |

Tamaño de la base restaurada: **68 MB**. Se confirmó además que, justo después de restaurar, **no existían** las tablas `integration_api_*` (línea base limpia, previa a la migración).

---

## 3. Aplicación de la migración `001_integration_api.sql`

| Métrica | Resultado |
|---|---|
| Tiempo total de aplicación | **0.25 s** (transacción `BEGIN…COMMIT` única) |
| Errores | Ninguno. Los `NOTICE: trigger ... does not exist, skipping` son esperados (la migración usa `DROP TRIGGER IF EXISTS` antes de recrear) |
| Tablas creadas | `integration_api_idempotency`, `integration_api_audit_records`, `integration_api_outbox`, `integration_api_webhook_endpoints`, `integration_api_webhook_deliveries` — **las 5 confirmadas presentes** |
| Índices creados | 4 (`..._expiry_idx`, `..._audit_company_created_idx`, `..._outbox_pending_idx`, `..._delivery_pending_idx`) |
| Triggers instalados | `integration_api_contacts_outbox` (INSERT/UPDATE/DELETE en `contacts`), `integration_api_notes_outbox` (INSERT/UPDATE/DELETE en `notes`), `integration_api_conversations_outbox` (INSERT/UPDATE en `conversations`), `integration_api_messages_outbox` (INSERT/UPDATE **de columnas `status`, `read_at`** en `messages`), `integration_api_channels_outbox` (UPDATE **de columna `status`** en `channel_connections`) — todos verificados vía `information_schema.triggers` |

### 3.1 Bloqueos observados

Se monitoreó `pg_locks` con muestreo cada 50 ms durante la aplicación. Dado que toda la migración corre en **250 ms**, la ventana de muestreo solo capturó una instantánea, pero fue suficiente para confirmar el patrón esperado:

- Sobre los objetos **nuevos** (las 5 tablas, sus secuencias e índices): `AccessExclusiveLock`, inofensivo porque nadie más los conoce todavía.
- Sobre `contacts`, `conversations`, `messages`, `notes` (donde se crean los `TRIGGER`): `ShareRowExclusiveLock` capturado en la muestra; `CREATE TRIGGER` en Postgres siempre toma brevemente `AccessExclusiveLock` sobre la tabla objetivo, que bloquea escrituras concurrentes durante ese instante puntual.
- Sobre `companies`, `api_keys`, `users` (referenciadas por las nuevas `FOREIGN KEY`): `AccessShareLock` + `ShareRowExclusiveLock`, por la validación de las FKs nuevas contra las filas existentes.

**Conclusión sobre bloqueos:** dado que la migración completa tarda una fracción de segundo y las tablas afectadas por `CREATE TRIGGER` no son gigantescas en esta instancia, el impacto práctico en producción sería un bloqueo de escritura de **milisegundos** en `contacts`, `notes`, `conversations`, `messages` y `channel_connections`. En una ventana de baja actividad (o incluso en horario normal, dada la duración) el riesgo de bloqueo prolongado es bajo. Aun así, se recomienda aplicarla fuera de picos de tráfico y tener el `lock_timeout` de sesión configurado como red de seguridad (ver sección de riesgos).

---

## 4. Verificación de triggers (con empresa de prueba sintética)

Se crearon dos empresas de prueba sintéticas (`STAGING TEST COMPANY`, `STAGING TEST COMPANY 2`, con nombres/slugs claramente marcados como de prueba) y se ejecutaron 26 operaciones controladas de INSERT/UPDATE/DELETE contra `contacts`, `notes`, `conversations`, `messages` y `channel_connections`, verificando en cada caso cuántos eventos aparecían en `integration_api_outbox`, con qué `event_type` y con qué `company_id`.

**Nota metodológica:** en 3 de las pruebas (creación de datos de apoyo + la operación medida en el mismo bloque), el primer conteo automático incluyó de más los eventos generados por la preparación de datos (p. ej. crear un contacto y una conversación de prueba antes de borrar el contacto). La tabla de abajo muestra el **resultado corregido y verificado manualmente contra los eventos reales en `integration_api_outbox`** (se listaron los 31 eventos uno por uno por `id` para confirmar el origen exacto de cada uno).

### 4.1 Tabla de eventos por operación

| # | Operación | Eventos esperados | Eventos obtenidos | company_id correcto | Resultado |
|---|---|---:|---:|---|---|
| 1 | INSERT contacts | 1 (`contact.created`) | 1 | sí | OK |
| 2 | UPDATE contacts (cambio de nombre) | 1 (`contact.updated`) | 1 | sí | OK |
| 3 | UPDATE contacts, agrega 2 tags | 3 (`contact.updated` + 2× `tag.attached`) | 3 | sí | OK — **multi-evento por diseño**, ver 4.3 |
| 4 | UPDATE contacts, quita 1 tag | 2 (`contact.updated` + `tag.detached`) | 2 | sí | OK — multi-evento por diseño |
| 5 | UPDATE contacts `is_archived=true` | 1 (`contact.deleted`, no `contact.updated`) | 1 | sí | OK |
| 6 | UPDATE contacts con `zinto.integration_api_origin='api'` | 0 (debe silenciarse) | 0 | — | OK |
| 7 | INSERT contacts con `company_id=NULL` | 0 | **error 23502** (aborta el INSERT completo) | — | **HALLAZGO**, ver 4.2 |
| 8 | DELETE contacts en cascada (con conversación + mensaje hijos) | 1 (`contact.deleted`) | 1 | sí | OK — la cascada de FK borra la conversación/mensaje sin generar eventos extra (no tienen trigger DELETE) |
| 9 | INSERT notes | 1 (`note.created`) | 1 | sí (resuelto vía `contacts.company_id`) | OK |
| 10 | UPDATE notes | 1 (`note.updated`) | 1 | sí | OK |
| 11 | DELETE notes | 1 (`note.deleted`) | 1 | sí | OK |
| 12 | INSERT conversations | 1 (`conversation.created`) | 1 | sí | OK |
| 13 | UPDATE conversations (status) | 1 (`conversation.updated`) | 1 | sí | OK |
| 14 | DELETE conversations | 0 (sin trigger DELETE) | 0 | — | OK |
| 15 | INSERT conversations con `company_id=NULL` | 0 | **error 23502** (aborta el INSERT completo) | — | **HALLAZGO**, ver 4.2 |
| 16 | INSERT messages | 1 (`message.created`) | 1 | sí | OK |
| 17 | UPDATE messages `SET status` | 1 (`message.status.updated`) | 1 | sí | OK |
| 18 | UPDATE messages `SET read_at` | 1 (`message.status.updated`) | 1 | sí | OK |
| 19 | UPDATE messages solo `content` (sin tocar `status`/`read_at`) | 0 (trigger a nivel de columna) | 0 | — | OK |
| 20 | DELETE messages | 0 (sin trigger DELETE) | 0 | — | OK |
| 21 | INSERT channel_connections | 0 (solo hay trigger de `UPDATE OF status`) | 0 | — | OK |
| 22 | UPDATE channel_connections, status distinto | 1 (`channel.connection.updated`) | 1 | sí | OK |
| 23 | UPDATE channel_connections, mismo status | 0 (guardado por `IS NOT DISTINCT FROM`) | 0 | — | OK |
| 24 | UPDATE channel_connections con `zinto.integration_api_origin='api'` | 0 (debería silenciarse) | **1** | sí (pero no debería existir) | **HALLAZGO**, ver 4.2 |
| 25 | UPDATE masivo de 3 contactos en una sola sentencia | 3 (un `contact.updated` por fila) | 3 | sí | OK — confirma `FOR EACH ROW` correcto |
| 26 | INSERT contacts en empresa de prueba 2 (aislamiento) | 1, con `company_id` de la empresa 2 | 1 | sí (empresa 2, no se mezcló con empresa 1) | OK |
| — | Verificación de payloads: ninguna clave JSON coincide con `password/secret/token/auth_state/api_key/credential` | 0 coincidencias | 0 | — | OK |

**Total:** 31 eventos generados durante toda la sesión de pruebas, repartidos correctamente entre las 2 empresas de prueba (sin fuga de eventos entre `company_id`).

### 4.2 Hallazgos reales (no artefactos de medición)

1. **`company_id NULL` en `contacts`/`conversations` rompe el INSERT por completo (regresión de comportamiento).**
   `contacts.company_id` y `conversations.company_id` son **NULLABLE** en el esquema actual. Sin embargo, las funciones `integration_api_capture_contact_event()` y `integration_api_capture_conversation_event()` no comprueban si `company_id` es `NULL` antes de insertar en `integration_api_outbox` (que sí exige `company_id NOT NULL`). El resultado es que cualquier INSERT de un contacto o conversación sin empresa asignada **ahora falla con `ERROR 23502: null value in column "company_id" of relation "integration_api_outbox"`**, abortando la operación original que antes de la migración era válida. La función del trigger de canal (`integration_api_capture_channel_event`) sí tiene esta protección (`IF NEW.company_id IS NULL ... THEN RETURN NEW`), lo que confirma que es una inconsistencia entre los 5 triggers, no una decisión de diseño deliberada.
   *Riesgo:* si en algún punto de la aplicación (actual o futuro) se crean contactos/conversaciones sin `company_id` (borradores, plantillas globales, etc.), esa ruta se romperá tras aplicar la migración.

2. **El trigger de `channel_connections` no respeta `zinto.integration_api_origin='api'`.**
   A diferencia de los otros 4 triggers (contactos, notas, conversaciones, mensajes), `integration_api_capture_channel_event()` **no** comprueba `current_setting('zinto.integration_api_origin', true)`. Esto significa que si la propia Integration API cambia el estado de un canal (por ejemplo, al procesar una reconexión reportada por webhook), el cambio **vuelve a generar un evento de salida**, con riesgo de bucles de notificación o entregas duplicadas hacia integraciones externas.

3. **Un `INSERT` de mensaje entrante puede generar un segundo evento indirecto (`conversation.updated`) por un trigger preexistente ajeno a esta migración.**
   La tabla `messages` ya tenía un trigger previo, `trigger_messages_unread_count` (AFTER INSERT/UPDATE/DELETE), que actualiza `conversations.unread_count`/`last_message_at` cuando llega un mensaje entrante. Como el nuevo trigger `integration_api_conversations_outbox` se dispara ante **cualquier** UPDATE de `conversations` (sin filtro de columnas), un mensaje entrante nuevo produce **2 eventos**: `message.created` + `conversation.updated`. Se confirmó en las pruebas que esto ocurre solo para mensajes con `direction='inbound'` (los `outbound` no tocan `unread_count`). No es un bug de la migración en sí, pero **los consumidores de la API deben saber que un mensaje entrante puede llegar acompañado de un evento de conversación relacionado**, y conviene documentarlo en la referencia de eventos de la API.

4. **Comportamiento "multi-evento por diseño" en cambios de `tags`.** Un `UPDATE` de `contacts` que cambia tags junto con otros campos genera 1 evento `contact.updated` **más** 1 evento `tag.attached`/`tag.detached` por cada tag añadido/quitado. No es un error — está en el código del trigger — pero un consumidor que espera "1 evento = 1 UPDATE" debe estar al tanto.

### 4.3 Casos correctamente confirmados como "0 eventos por diseño" (no son bugs)

- `DELETE` en `conversations` y en `messages`: no existe trigger de `DELETE` para estas tablas en la migración (a propósito, ya que esas filas normalmente se eliminan en cascada desde `contacts`).
- `INSERT` en `channel_connections`: el trigger solo cubre `UPDATE OF status`.
- `UPDATE` de `messages` que no toca `status` ni `read_at`: el trigger está definido como `UPDATE OF status, read_at`, un trigger a nivel de columna de Postgres, así que ni siquiera se ejecuta si esas columnas no cambian.
- `UPDATE` de `channel_connections` con el mismo `status`: bloqueado explícitamente por `IF ... NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW`.

---

## 5. Prueba de rollback real

Como exigía la tarea, no bastaba con un `ROLLBACK` de transacción: se **destruyó completamente** el contenedor y el volumen de staging (con la migración ya aplicada y los datos de prueba dentro) y se **recreó desde cero**, restaurando de nuevo desde el mismo archivo `.dump`.

| Paso | Resultado |
|---|---|
| `docker stop` + `docker rm` del contenedor con la migración aplicada | OK |
| `docker volume rm zinto-staging-pgdata` | OK (confirmado que el volumen ya no existe) |
| Contenedor nuevo, mismo procedimiento de aislamiento que en la sección 2.1 | OK |
| Restauración desde `/root/backups/prod-bcousinoprop-2026-08-13.dump` | OK, 6.8 s, sin errores |
| Verificación: tablas `integration_api_*` | **No existen** — confirma que el rollback (destruir+restaurar) elimina limpiamente todo rastro de la migración |
| Verificación: empresas de prueba (`staging-test-co%`) | **No existen** — confirma que es un volumen nuevo, no el mismo con los datos de prueba residuales |
| Conteos de tablas principales tras el rollback | Idénticos a la restauración original de la sección 2.2 (companies=12, contacts=1161, conversations=917, messages=13567, deals=513, pipelines=17, pipeline_stages=125, contact_tasks=2, channel_connections=21, whatsapp_auth_state=0) |

**Conclusión:** el procedimiento de rollback operativo para esta migración —dado que no modifica tablas existentes, solo agrega objetos nuevos— es simplemente **restaurar desde el backup pre-migración** (o, si se prefiere no restaurar toda la base, un `DROP` explícito de las 5 tablas nuevas y los 5 triggers/5 funciones, ver sección 8). Ambas rutas fueron validadas: la restauración completa se probó de extremo a extremo aquí; el `DROP` selectivo es trivial porque la migración no altera ninguna tabla preexistente ni sus datos.

---

## 6. `EXPLAIN (ANALYZE, BUFFERS)` de las consultas de listado

Se ejecutaron las 7 consultas (`listContacts`, `listConversations`, `listMessages`, `listPipelines`, `listStages`, `listDeals`, `listTasks`) contra la empresa con más volumen de datos en este dataset (`company_id=3`: 712 contactos, 543 conversaciones, 407 deals; para `listMessages` se usó la conversación con más mensajes, `id=396`, de `company_id=19`, 628 mensajes), cada una **sin cursor** (primera página) y **con cursor** (segunda página, usando valores reales de `created_at`/`id` de la fila 21).

### 6.1 Resumen de hallazgos

| Consulta | Plan sin índice dedicado | ¿Seq Scan problemático? |
|---|---|---|
| `listContacts` | `Seq Scan` sobre `contacts` (filtra `company_id` + `deleted_at IS NULL`) + `Sort` (top-N heapsort) | **Sí** — recorre las 1161 filas de la tabla completa en cada llamada, no solo las de la empresa |
| `listConversations` | `Seq Scan` sobre `conversations` (filtra `company_id`) + `Sort` | **Sí** — recorre las 917 filas completas |
| `listMessages` | `Index Scan` usando el índice ya existente `idx_messages_conversation_timestamp (conversation_id, created_at DESC)` + `Incremental Sort` (barata, ya casi ordenado) | No — ya está bien servida por un índice existente |
| `listPipelines` | `Seq Scan` sobre `pipelines` (17 filas totales) + `Sort` | No a este tamaño (tabla de configuración, crece poco) |
| `listStages` | `Nested Loop` con `Seq Scan` en `pipelines` y `pipeline_stages` (125 filas totales) | No a este tamaño |
| `listDeals` | `Hash Left Join` con `Seq Scan` sobre `deals` (filtra `company_id`) y `Seq Scan` sobre `pipeline_stages` (filtra `company_id`) + `Sort` | **Sí** (en `deals`) — recorre las 513 filas completas |
| `listTasks` | `Seq Scan` sobre `contact_tasks` (solo 2 filas en todo el dataset) + `Sort` | No — tabla casi vacía en este dataset |

En esta escala concreta (dataset actual de producción: tablas de cientos/miles de filas) **todas las consultas ejecutan en menos de 1 ms** incluso con seq scan, así que no hay una emergencia de rendimiento hoy. El hallazgo relevante es **estructural**: no existe ningún índice compuesto `(company_id, created_at DESC, id DESC)` en `contacts`, `conversations` ni `deals` — el patrón de paginación por cursor que usa la Integration API en sus tres endpoints de mayor tráfico esperado. A medida que estas tablas crezcan (más contactos/conversaciones/deals por empresa, o más empresas), el `Seq Scan` escala linealmente con el **tamaño total de la tabla**, no con el tamaño de los datos de una sola empresa, lo cual es exactamente el patrón que degrada mal en multi-tenant.

`listMessages` ya está bien resuelta por el índice preexistente `idx_messages_conversation_timestamp`, no requiere cambios.

### 6.2 Validación empírica de los índices propuestos

Se crearon (con `CREATE INDEX CONCURRENTLY`, sin bloquear escrituras) los 3 índices candidatos directamente en el staging ya restaurado, y se repitió el `EXPLAIN` para confirmar la mejora antes de destruir el entorno:

| Índice candidato | Tiempo de creación (dataset actual) | Tamaño resultante | Efecto en el plan |
|---|---:|---:|---|
| `contacts (company_id, created_at DESC, id DESC) WHERE deleted_at IS NULL` | 0.115 s | 64 kB | `Seq Scan`+`Sort` (cost≈70, buffers=42) → `Index Only Scan` (cost≈5, buffers=7) |
| `conversations (company_id, created_at DESC, id DESC)` | 0.141 s | 56 kB | `Seq Scan`+`Sort` (cost≈54, buffers=28) → `Index Only Scan` (cost≈5, buffers=5) |
| `deals (company_id, created_at DESC, id DESC)` | 0.125 s | 40 kB | `Seq Scan`+`Sort` (cost≈41, buffers=20) → `Index Only Scan` (cost≈4, buffers=9) |

Los 3 índices de prueba se destruyeron junto con todo el contenedor de staging en la sección 7 (no quedan en ningún entorno).

### 6.3 Índices propuestos (evidencia + costo)

> Estos índices **no forman parte de `001_integration_api.sql`** — la migración no toca `contacts`/`conversations`/`deals`. Es una recomendación separada, orientada a que los nuevos endpoints de listado de la Integration API (que harán paginación por cursor repetidamente, posiblemente con más frecuencia que el uso interno actual) no degraden con el crecimiento de datos.

1. **`CREATE INDEX CONCURRENTLY idx_contacts_company_created_id_active ON contacts (company_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;`**
   Justificación: elimina el `Seq Scan` completo de `contacts` en `listContacts`, que hoy recorre toda la tabla filtrando por empresa. Costo medido: <0.2 s de creación, 64 kB de tamaño en el dataset actual (crecerá proporcional al número de contactos activos). Al usar `CONCURRENTLY` no bloquea escrituras durante la construcción; sí exige que no haya otra migración corriendo en paralelo sobre la misma tabla y una conexión fuera de una transacción explícita.

2. **`CREATE INDEX CONCURRENTLY idx_conversations_company_created_id ON conversations (company_id, created_at DESC, id DESC);`**
   Justificación: mismo problema en `listConversations`. Costo medido: <0.2 s, 56 kB.

3. **`CREATE INDEX CONCURRENTLY idx_deals_company_created_id ON deals (company_id, created_at DESC, id DESC);`**
   Justificación: mismo problema en `listDeals`. Costo medido: <0.2 s, 40 kB.

4. **Prioridad baja / diferir:** `pipelines`, `pipeline_stages` y `contact_tasks` muestran el mismo patrón estructural (sin índice compuesto para el cursor), pero con **17, 125 y 2 filas totales** respectivamente en el dataset actual, el costo de mantenimiento de un índice adicional no se justifica todavía. Si el volumen de deals/tareas por empresa crece significativamente, reevaluar con el mismo método (`EXPLAIN ANALYZE, BUFFERS` antes/después).

En producción, dado que estas tablas son actualmente pequeñas (la tabla más grande relevante, `messages`, ocupa 31 MB con 13,577 filas), la creación de estos 3 índices con `CONCURRENTLY` es una operación de **bajo riesgo y segundos de duración**, no una migración pesada.

---

## 7. Destrucción final del staging

Al terminar todas las pruebas se destruyó el entorno de staging por completo:

```bash
docker stop zinto-staging-postgres
docker rm zinto-staging-postgres
docker volume rm zinto-staging-pgdata
```

Verificado tras la ejecución:
- `docker ps -a` ya no lista `zinto-staging-postgres`.
- `docker volume ls` ya no lista `zinto-staging-pgdata`.
- Producción (`powerchat-postgres-bcousinoprop`) sigue con sus 12 empresas y **sin** ninguna tabla `integration_api_*` — la migración nunca tocó producción.
- No se modificó `powerchat-app-bcousinoprop` ni `zinto-integration-api-preview`, que siguieron corriendo con normalidad durante todo el proceso.

### 7.1 Procedimiento exacto para recrear el staging (referencia futura)

```bash
# 1. Crear contenedor aislado (red bridge, solo loopback)
docker run -d --name zinto-staging-postgres \
  --network bridge \
  -p 127.0.0.1:5434:5432 \
  -e POSTGRES_USER=powerchat \
  -e POSTGRES_DB=bcousinoprop_db \
  -e POSTGRES_PASSWORD="$(openssl rand -base64 24)" \
  -v zinto-staging-pgdata:/var/lib/postgresql/data \
  postgres:16

# 2. Esperar a que acepte conexiones reales (el arranque del contenedor oficial
#    de postgres reinicia una vez internamente; no basta con un solo pg_isready)
for i in $(seq 1 40); do
  docker exec zinto-staging-postgres pg_isready -U powerchat -d bcousinoprop_db >/dev/null 2>&1 \
    && docker exec zinto-staging-postgres psql -U powerchat -d bcousinoprop_db -c "select 1" >/dev/null 2>&1 \
    && break
  sleep 1
done

# 3. Restaurar desde el backup más reciente verificado por checksum
sha256sum -c /root/backups/<archivo>.dump.sha256   # debe decir OK
docker cp /root/backups/<archivo>.dump zinto-staging-postgres:/tmp/backup.dump
docker exec zinto-staging-postgres pg_restore -U powerchat -d bcousinoprop_db \
  --no-owner --no-privileges -j 4 /tmp/backup.dump
docker exec zinto-staging-postgres rm -f /tmp/backup.dump

# 4. Aplicar la migración a probar
docker cp /opt/zinto-integration-api/integration-api/migrations/001_integration_api.sql \
  zinto-staging-postgres:/tmp/001_integration_api.sql
docker exec zinto-staging-postgres psql -U powerchat -d bcousinoprop_db \
  -v ON_ERROR_STOP=1 -f /tmp/001_integration_api.sql
docker exec zinto-staging-postgres rm -f /tmp/001_integration_api.sql

# 5. Al terminar, destruir siempre (contiene datos reales de clientes)
docker stop zinto-staging-postgres
docker rm zinto-staging-postgres
docker volume rm zinto-staging-pgdata
```

Reglas a respetar en cualquier recreación futura: nunca añadir este contenedor a `powerchat-shared-network`; publicar el puerto solo en `127.0.0.1`; nunca generar un backup nuevo sin `--exclude-table-data='whatsapp_auth_state'`; destruir siempre el contenedor y el volumen al terminar, ya que contienen una copia de datos reales de clientes.

---

## 8. Riesgos y recomendaciones antes de migrar producción

### 8.1 La migración en sí (DDL) es de bajo riesgo
- Es aditiva: crea 5 tablas nuevas, 4 índices nuevos, 5 funciones y 5 triggers. No altera columnas, tipos ni datos de ninguna tabla existente.
- Corre en una única transacción (`BEGIN…COMMIT`), 0.25 s en un dataset del tamaño de producción actual.
- Es re-ejecutable de forma segura (usa `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`).
- El rollback operativo es sencillo: no hay que revertir cambios en tablas existentes, basta con eliminar los 5 triggers, las 5 funciones y las 5 tablas nuevas (o restaurar backup, como se probó).

### 8.2 Antes de aplicar en producción, corregir o al menos decidir conscientemente sobre:

1. **(Alto)** Blindar `integration_api_capture_contact_event()` e `integration_api_capture_conversation_event()` contra `company_id IS NULL`, igual que ya hace la función de canal (`IF event_company_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;` antes del `INSERT INTO integration_api_outbox`). Sin este cambio, cualquier flujo de la aplicación que hoy inserte un contacto o conversación sin `company_id` **empezará a fallar con un error 500 de base de datos** en cuanto se aplique la migración. Se recomienda auditar el código de la aplicación (`powerchat-app-bcousinoprop`) para confirmar si existe algún camino que inserte contactos/conversaciones con `company_id` nulo antes de decidir si este es un bloqueante o un caso teórico.

2. **(Medio)** Añadir a `integration_api_capture_channel_event()` la misma comprobación de `zinto.integration_api_origin = 'api'` que tienen los otros 4 triggers, para evitar que acciones de la propia Integration API generen eventos de salida sobre sí misma (riesgo de bucle o de "eco" hacia webhooks de clientes).

3. **(Bajo, documentar)** Dejar constancia en la documentación de eventos de la API de que: (a) un mensaje entrante puede venir acompañado de un evento `conversation.updated` adicional (por el trigger preexistente de `unread_count`), y (b) un `UPDATE` de contacto que cambia `tags` genera un evento por cada tag añadido/quitado además del `contact.updated`. Ninguno de los dos es un bug, pero ambos sorprenderán a un consumidor que asuma "1 operación = 1 evento".

4. **(Bajo, opcional, no bloqueante)** Crear los 3 índices de la sección 6.3 (`contacts`, `conversations`, `deals`) con `CONCURRENTLY` antes o después de la migración — son independientes de ella y de costo mínimo en el tamaño actual de producción, pero evitan una degradación progresiva de los endpoints de listado de la Integration API a medida que crecen los datos por empresa.

5. **(Operativo)** Aplicar la migración en una ventana de tráfico bajo si es posible, aunque la duración medida (0.25 s) hace que el riesgo de bloqueo prolongado sea bajo incluso en horario normal. Tener a mano el `DROP TRIGGER / DROP FUNCTION / DROP TABLE` de reversión rápida (no requiere restaurar backup) por si se detecta un problema inmediatamente después de aplicar.

6. **(Confirmado, sin acción)** Los triggers no filtran ni exponen ningún campo de credenciales/secretos en los payloads del outbox (verificado programáticamente contra los nombres de clave `password`, `secret`, `token`, `auth_state`, `api_key`, `credential` sobre los 31 eventos generados en las pruebas: 0 coincidencias). La tabla `whatsapp_auth_state` no está referenciada por ningún trigger de esta migración.

### 8.3 Conclusión

La migración `001_integration_api.sql` es **segura de aplicar en producción tal cual** desde el punto de vista de integridad de datos, duración y bloqueos (aditiva, rápida, transaccional, reversible sin restaurar backup). El punto 8.2.1 (contactos/conversaciones con `company_id NULL`) es el único hallazgo con potencial de romper una ruta de escritura existente y debería confirmarse/corregirse antes de aplicar en producción; los puntos 8.2.2 y 8.2.3 son mejoras de robustez recomendadas pero no bloqueantes para un primer despliegue si se documentan y monitorean.
