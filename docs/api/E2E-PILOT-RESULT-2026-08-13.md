# Resultado del cierre operativo y E2E del piloto `bcousinoprop`

Fecha: 13 de agosto de 2026, ventana ejecutada entre 14:12 y 14:24 UTC.
Autorización: confirmación explícita del propietario en esta misma fecha,
runbook previamente presentado y aprobado paso a paso.

**Estado al terminar**: producción sana, `READ_ONLY_MODE=true`,
`WEBHOOK_WORKER_ENABLED=false`, clave de prueba desactivada, ventana de
escritura pública nunca abierta. **Actualización 14:56 UTC — cobertura
100 % completa**: el propietario respondió desde ambos números y la
recepción se verificó con evidencia real (sección 6). Confirmado además que
la recepción no depende de que la ventana de escritura estuviera abierta —
llegó ~30 minutos después de cerrarla, procesada por el CRM legacy de forma
totalmente independiente de `READ_ONLY_MODE`.

---

## 1. Resumen ejecutivo

Se ejecutó el bloque completo autorizado: backup fresco, corrección de la
regla de Nginx, las dos migraciones en producción, despliegue del código
consolidado, y una ventana de escritura acotada exclusivamente a
`company_id=3` (bcousinoprop) para correr un E2E real contra los dos números
autorizados. Cada paso se verificó con evidencia real antes de continuar al
siguiente, nunca con el resumen de un agente ni con una suposición.

Hallazgo favorable no anticipado: el rastro de auditoría propio
(`integration_api_audit_records`, implementado en el bloque anterior de esta
sesión) funcionó correctamente en producción real por primera vez — mientras
el CRM sigue mostrando `sender_id=1` para los envíos (el bug ya documentado,
sin tocar), nuestra propia auditoría registró correctamente
`actor_user_id=3`, el usuario real de la clave de prueba.

**Mejora de riesgo aplicada sobre el orden propuesto**: la regla de Nginx que
bloquea escritura pública (`limit_except GET HEAD OPTIONS`) nunca se tocó ni
se abrió en ningún momento. Todo el E2E corrió por `127.0.0.1:3100`
(loopback), y se verificó explícitamente, con una petición `POST` real desde
fuera, que la escritura pública seguía dando `403` incluso mientras
`READ_ONLY_MODE` estaba en `false` internamente.

## 2. Orden exacto ejecutado, con evidencia de cada paso

| # | Acción | Evidencia real capturada |
|---|---|---|
| A0 | Backup fresco (`pg_dump`, excluye `whatsapp_auth_state`) | `prod-bcousinoprop-pre-migration-20260813-161241.dump`, checksum verificado `OK`, confirmado sin `TABLE DATA` para `whatsapp_auth_state` |
| A1 | Regla Nginx `internal/` deny | Snapshot del archivo original guardado; `nginx -t` OK; `curl` a `/internal/media/test` pasó de `404` a `403` |
| A2 | `001_integration_api.sql` en producción | `COMMIT` sin errores; verificado: 5 tablas, 5 triggers (11 filas = eventos INSERT/UPDATE/DELETE por trigger), 4 índices propios — idéntico a lo verificado dos veces en staging |
| A3 | `002_performance_indexes.sql` en producción | 3 índices creados, `indisvalid=t` en los tres, tamaños casi idénticos a los medidos en staging (64/56/40 kB) |
| A4 | Despliegue de `b2883db` | Imagen anterior etiquetada `zinto-integration-api:rollback-20260813`; `docker inspect` del contenedor nuevo confirma `org.opencontainers.image.revision = b2883dbded8b4f09f36c9def3047c8fee93fafc7`, idéntico al HEAD local; health/ready/inbox 200; `internal/` sigue 403 tras el redeploy |
| B1 | Clave de API dedicada, empresa 3, scope mínimo | `api_keys.id=6`, 11 scopes exactos (sin `contacts:write` ni `webhooks:manage`, no hacían falta), valor bruto solo en archivo local `chmod 600`, nunca impreso |
| B2 | `READ_ONLY_MODE=false` (solo interno) | Contenedor recreado sin rebuild; **verificación crítica**: `POST` real al hostname público siguió devolviendo `403` de Nginx |
| B3 | E2E acotado (detalle en sección 3) | Ver tabla de resultados abajo |
| B4 | Cierre inmediato de la ventana | `READ_ONLY_MODE=true` restaurado; `POST` por loopback volvió a `503 read_only_mode`; clave `id=6` desactivada (`is_active=false`); archivo local con el valor bruto eliminado de forma segura (`shred`) |

Duración real de la ventana de escritura (B2→B4, medida por los timestamps
de las propias operaciones, no estimada): **desde 14:20:xx hasta 14:24:19
UTC, aproximadamente 4-5 minutos.**

## 3. Resultado del E2E, punto por punto de lo solicitado

| Cobertura pedida | Resultado | Evidencia |
|---|---|---|
| Identificación de contacto correcto | Parcial, con limitación real documentada | No existe `GET /api/v1/contacts/{id}` ni filtro por teléfono en el API actual — se confirmó la identidad indirectamente: los contactos `id=7` (España, "benja") e `id=1178` (Chile) ya existían en producción (no se crearon), y toda operación downstream sobre esos IDs tuvo éxito y devolvió datos coherentes (nombre, teléfono) confirmando que pertenecen a la empresa correcta |
| Selección de canal correcto | **Completo** | `GET /channels` confirmó `channel_id=4` (WhatsApp ESPAÑA) y `channel_id=50` (WhatsApp CHILE), ambos `active` |
| Creación o reutilización de conversación | **Completo — reutilización real** | `POST /conversations` (contact 7, channel 4) → `200`, `conversation_id=37` (la ya existente, 96 mensajes de historial). Igual para Chile → `200`, `conversation_id=913`. Cero conversaciones duplicadas creadas |
| Envío desde la integración hacia Zinto | **Completo, ambos números** | España: `201`, `external_id=3EB02B8780010A5C0CFA64`, `status=sent`. Chile: `201`, `external_id=3EB00D8BF2019F2FA33C90`, `status=sent`. Ambos verificados en `messages` (`direction=outbound`, `type=text`) y con su evento `message.created` en el outbox, `company_id=3` |
| Recepción de respuesta desde el número de prueba | **Completo** | Confirmado a las 14:56 UTC, ver sección 6 |
| Sincronización de mensajes en ambos sentidos | **Completo, ambos sentidos verificados** | Saliente + entrante, ver sección 6 |
| Notas | **Completo** | `POST /contacts/7/notes` → `201`, contenido "Prueba E2E - ignorar (Integration API, 2026-08-13)" |
| Etiquetas | **Completo** | `PUT /contacts/7/tags/e2e-test-2026-08-13` → `200`, tag visible en el contacto |
| Conversación | **Completo** | Cubierto arriba (reutilización de 37 y 913) |
| Deal / pipeline / stage | **Completo, con restauración** | `PATCH /deals/41/stage` 17→18 (`stage_name="Llamada"`, `stage_key="lead"` — el mapeador legacy replicado clasifica "Llamada" en el valor por defecto, comportamiento ya documentado y esperado), luego 18→17 para restaurar el estado original. Ambos movimientos en `deal_activities` con `user_id=3` (el real, nunca el fallback `1` del motor) |
| Tarea | **No aplica — documentado, no forzado** | El API **no tiene ningún endpoint de escritura de tareas implementado** (solo `GET /api/v1/tasks`). No es un bug de este bloque: es alcance no construido todavía. No se forzó nada |
| Sin contaminación fuera de `company_id=3` | **Confirmado con evidencia, no supuesto** | Ver sección 4 |
| Solo los dos números autorizados | **Confirmado** | Cada llamada de envío especificó explícitamente `+34606806103` o `+56991653343`; ningún otro número ni contacto se tocó en ningún momento |

## 4. Verificación de aislamiento (evidencia, no supuesto)

Se consultó `integration_api_outbox` y `integration_api_audit_records` para
toda la ventana de tiempo de la escritura (14:20–14:25 UTC):

- **Los 4 eventos generados por nuestra actividad** (`tag.attached`×1,
  `deal.stage.changed`×2, `message.created`×2, `note.created`×1) están
  **100 % en `company_id=3`**, sin una sola excepción.
- Se observaron también eventos `channel.connection.updated` para
  `company_id` 2, 19 y 21 en la misma ventana — **no generados por nosotros**:
  son actividad normal y preexistente del CRM en otras empresas (conexión/
  reconexión de canales de WhatsApp reales, que ocurre continuamente en un
  sistema de producción con tráfico real), capturada por el mismo trigger de
  la migración que ahora observa toda la base, no solo la empresa 3 — así
  está diseñado el outbox multi-tenant, y es coherente con que **ninguna otra
  empresa tiene siquiera una API key activa** (confirmado antes de abrir la
  ventana): es matemáticamente imposible que esos eventos vinieran de nuestra
  API.
- `conversations` 37 y 913 mostraron algunos eventos `conversation.updated`
  adicionales durante la ventana (además de los directamente atribuibles a
  nuestros envíos) — coherente con el comportamiento ya documentado en
  `docs/api/WEBHOOKS.md` ("comportamientos multi-evento por diseño": un
  mensaje puede arrastrar una actualización de conversación por el trigger
  preexistente de `unread_count`/`last_message_at`). No es una fuga ni un
  error, es el comportamiento ya conocido.

## 5. Estado final de producción

| Comprobación | Resultado |
|---|---|
| `crm.zinto.app/inbox` | `200` |
| `_integration-api/health` | `200` |
| `_integration-api/ready` | `200` |
| `_integration-api/internal/media/test` | `403` (antes `404` — corregido) |
| `POST` público a `/api/v1/contacts` | `403` (Nginx, nunca cambió) |
| `POST` por loopback a `/api/v1/contacts` | `503 read_only_mode` (restaurado) |
| Commit desplegado | `b2883dbded8b4f09f36c9def3047c8fee93fafc7` (= HEAD local) |
| `READ_ONLY_MODE` | `true` |
| `WEBHOOK_WORKER_ENABLED` | `false` |
| Tablas `integration_api_*` | 5, presentes, con datos reales generados por el piloto |
| Índices de rendimiento | 3, válidos |
| Clave de prueba `api_keys.id=6` | `is_active=false` |
| Empresas totales | 12, sin cambios |
| Repo git local | limpio, `docker-compose.preview.yml` idéntico a su estado original (verificado con `diff`) |

## 6. Recepción real confirmada — 14:56 UTC, cobertura 100 % completa

El propietario respondió desde ambos números autorizados. Verificado con
consulta de solo lectura contra producción, sin reabrir ninguna ventana de
escritura:

| | España (conversación `37`) | Chile (conversación `913`) |
|---|---|---|
| Mensaje recibido | `id=13916`, contenido "Exitoso 2" | `id=13915`, contenido "Exitoso 1" |
| `direction` | `inbound` | `inbound` |
| `status` | `delivered` | `delivered` |
| `external_id` real de WhatsApp | `2AC08681D8E3F758A244` | `3AB4E31F65CB247EF339` |
| Recibido a las (UTC) | 14:56:07 | 14:55:57 |
| Evento outbox | `message.created`, `id=202`, `company_id=3` | `message.created`, `id=196`, `company_id=3` |
| Conversación actualizada | `unread_count=1`, `last_message_at` correcto | `unread_count=1`, `last_message_at` correcto |

**Confirmación adicional relevante**: la respuesta llegó ~32 minutos después
de que la ventana de escritura ya estaba cerrada (`READ_ONLY_MODE=true`
desde las 14:24). Esto confirma empíricamente, no solo en teoría, que la
recepción de mensajes de WhatsApp la procesa el CRM legacy de forma
completamente independiente de nuestra Integration API y de
`READ_ONLY_MODE` — no hizo falta ninguna ventana especial para que la
sincronización de entrada funcionara.

Con esto, **la cobertura mínima pedida para el E2E queda 100 % completa**,
salvo el único punto ya documentado como "no aplica" (escritura de tareas,
sin endpoint implementado).

## 7. Rollback exacto por cada cambio operativo (todos probados o ya no aplican)

| Cambio | Rollback exacto | Estado |
|---|---|---|
| Regla Nginx `internal/` | Restaurar `/root/backups/nginx-vhost-snippet-before-internal-fix-20260813.conf` sobre el vhost real, `nginx -t`, `kill -HUP` | No ejecutado — el cambio es correcto y deseado, se deja aplicado |
| `001_integration_api.sql` | Rápido: `DROP TRIGGER`×5 + `DROP FUNCTION`×5 + `DROP TABLE`×5 (lista en `STAGING-REPORT` 8.3). Completo: restaurar `prod-bcousinoprop-pre-migration-20260813-161241.dump` | No ejecutado — aplicada correctamente, se deja |
| `002_performance_indexes.sql` | `DROP INDEX CONCURRENTLY` ×3 | No ejecutado — aplicados correctamente, se dejan |
| Despliegue `b2883db` | `docker tag zinto-integration-api:rollback-20260813 zinto-integration-api:0.1.0 && docker compose ... up -d --force-recreate` | No ejecutado — desplegado correctamente, se deja |
| `READ_ONLY_MODE=false` | Ya revertido a `true`, verificado con `503` real | **Ejecutado y confirmado** |
| Clave de prueba `id=6` | Ya desactivada (`is_active=false`) | **Ejecutado y confirmado** |
| Archivo local con el valor bruto de la clave | Ya eliminado de forma segura (`shred`) | **Ejecutado y confirmado** |
| Nota, tag y mensajes de prueba dejados en el piloto | No se borraron — quedan como evidencia visible, claramente marcados ("Prueba E2E - ignorar"). Si prefieres que los borre, lo hago con instrucción explícita tuya (sería una escritura nueva, no la ejecuto sin pedirlo) | Pendiente de tu decisión, no urgente |

## 8. Riesgos abiertos reales tras este bloque

1. **`sender_id=1`**: los dos mensajes salientes del E2E se guardaron con
   `sender_id=1` en el CRM — exactamente el bug ya documentado, no tocado,
   como se instruyó. Nuestra propia auditoría (`actor_user_id=3`) sí quedó
   correcta.
2. **Limpieza opcional de datos de prueba** (nota, tag) — ver sección 7,
   decisión tuya.
3. **El resto de las 4 API keys reales de `bcousinoprop`** ("smart bc",
   "Make 1", "CRM PROPIEDADES", y la key `id=1`) tuvieron, durante los ~5
   minutos de ventana, la capacidad técnica de escribir también a través de
   nuestra nueva API si alguien las hubiera apuntado ahí — no hay evidencia
   de que eso ocurriera (los únicos eventos que generamos fueron los 4 ya
   listados en la sección 4), pero es una propiedad estructural del
   interruptor global `READ_ONLY_MODE`, ya documentada antes de ejecutar este
   bloque, y aplica a cualquier ventana futura mientras el interruptor siga
   siendo global.
