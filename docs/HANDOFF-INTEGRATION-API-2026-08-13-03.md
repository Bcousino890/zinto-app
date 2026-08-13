# Relevo 03: bloque grande listo para el único push

Fecha: 13 de agosto de 2026. Complementa `CLAUDE-HANDOFF-INTEGRATION-API-2026-08-13.md`
y `HANDOFF-INTEGRATION-API-2026-08-13-02.md`. Cubre los dos bloques de trabajo
hechos en esta sesión, desde `1c425ab` (donde terminaba el relevo anterior)
hasta `dd74900` (HEAD actual).

**Nada de esto se ha desplegado ni empujado a GitHub.** `origin/codex/integration-api-v1`
sigue en `3417c32`. HEAD local está **53 commits por delante** de `origin`.
El propietario hace el único push desde su Mac cuando decida.

## Documentos de cierre (añadidos después de este relevo, mismo día)

Cuatro documentos nuevos, cada uno la referencia única y definitiva de su
tema — no repiten detalle que ya vivía en otro documento, enlazan hacia él:

- `docs/api/FINDING-NGINX-INTERNAL-PREFIX-2026-08-13.md` — el hallazgo de la
  regla de Nginx sin aplicar, con el cambio mínimo exacto y su verificación.
- `docs/api/BUGFIXES-VERIFIED-2026-08-13.md` — los dos bugs reales de este
  bloque, cómo se encontraron y cómo se validó cada corrección.
- `docs/api/ACTIVATION-READINESS-2026-08-13.md` — matriz de qué está listo
  para activar y qué sigue bloqueado, y por qué tipo de bloqueo exactamente.
- `docs/api/E2E-READINESS-2026-08-13.md` — el formato exacto de datos que
  necesito para el E2E, y qué falta además de esos datos.

---

## Resumen ejecutivo

Bloque 1 (deals, delivery, índices — ya reportado en el chat, resumido aquí
por completitud):

- Escritura de `deals.stage`/`stage_id` (`PATCH /api/v1/deals/{id}/stage`),
  replicando el motor legacy exactamente, mapeador con su bug conocido
  incluido a propósito.
- Auditoría y endurecimiento de `src/delivery/client.ts`: reintento seguro
  ante fallos de conexión, rastro de auditoría propio con el autor real del
  envío, distinción `delivery_rejected`/`delivery_failed`.
- Los 3 índices de rendimiento verificados en staging, preparados como
  `migrations/002_performance_indexes.sql`, **no aplicados en producción**.
- Documentación de los dos comportamientos multi-evento del webhook.

Bloque 2 (esta sesión, en orden de ejecución):

1. **Riesgo cerrado**: esquema real de `deal_activities` verificado en
   staging aislado — el `INSERT` ya escrito era correcto, sin columnas
   ocultas (`docs/api/SCHEMA-VERIFICATION-2026-08-13-02.md`).
2. **Hallazgo operativo real**: la regla de Nginx que debería bloquear
   `/_integration-api/internal/` **no está aplicada** en el vhost real —
   confirmado leyendo el snippet que aaPanel tiene cargado, no solo la
   documentación (`docs/api/OPERATIONAL-READINESS-2026-08-13.md`).
3. **4 agentes en paralelo, verificados y fusionados**:
   - Filtros `updated_since` en contactos/conversaciones/mensajes +
     `GET /api/v1/messages/{id}`.
   - Retención/limpieza periódica de `integration_api_idempotency`,
     `integration_api_outbox` y `integration_api_webhook_deliveries`.
   - `POST /api/v1/conversations` (crear o encontrar sin duplicar), usando
     `pg_advisory_xact_lock` porque `conversations` no tiene restricción
     única real.
   - Auditoría completa de `openapi.yaml` contra el comportamiento real de
     las 27 rutas (Bloque 6, auditoría de contrato).
4. **Un quinto agente**: métricas operacionales (`GET /internal/metrics`,
   Prometheus, desactivado por defecto por el mismo motivo que el proxy de
   media — la regla de Nginx de arriba).
5. **Dos bugs reales encontrados y corregidos durante la verificación**, no
   por los propios agentes:
   - `listMessages`/`findMessage` filtraban por `messages.updated_at`, una
     columna que **no existe** en el esquema real (solo `messages` tiene
     `created_at`) — habría fallado en producción con "column does not
     exist" en la primera petición con `updated_since`. Corregido para
     filtrar por `created_at`, documentado como limitación real.
   - `PUT`/`DELETE /api/v1/contacts/:id/tags/:tag` validaba el `tag` con un
     `.parse()` sin envolver en vez del helper del propio archivo — un tag
     que colapsa a vacío tras `.trim()` producía un `500` sin envolver en
     vez de un `400` canónico. Encontrado por el agente de auditoría de
     contrato, corregido por mí directamente (bug de lógica, fuera del
     alcance de esa auditoría).

Todos los agentes trabajaron en git worktrees aislados; cada uno se verificó
de forma independiente (suite completa + typecheck + build, nunca solo el
resumen del agente) antes de fusionar. Un agente (auditoría de
`delivery/client.ts`, bloque 1) murió a mitad de tarea por límite de gasto de
la cuenta; su trabajo parcial (código y tests completos, sin commitear) se
revisó, se completó el documento que faltaba y se verificó igual que el
resto.

---

## Lista exacta de commits locales (53, desde `origin/codex/integration-api-v1`)

```
70cabd1 docs: hand off the state after the SSRF hardening
05fa20e docs(api): plan the next phase against the real schema
02efcfb docs: record the GitHub token exposed on the VPS
c1259cd feat(api): download partner media instead of forwarding its URL
fc8d354 docs(api): explain the media proxy and what enabling it still needs
616e4b8 docs(api): describe media destination rules in the contract
0be8dd3 feat(api): expose pipelines, stages, deals and tasks read-only
cfcb485 merge: read-only pipeline, deal and task resources
7f29008 feat(api): document the new resources and assert contract parity
7d36ba2 docs(api): explain the read-only pipeline resources
0bb06c7 docs(api): audit the compiled CRM for authorship and stage semantics
3bbdc7d docs(api): fold the legacy engine audit into the phase plan
145e5ff fix(logging): redact query-string secrets and harden legacy error handling
4ec7de4 docs(api): independent security audit of SSRF, media and tenant isolation
05f4e06 feat(http): cap request body size with canonical 413 responses
d967dda fix(api): refuse send-media outright when the proxy is not configured
0afc3c7 fix(api): allowlist media content types instead of matching by prefix
d24e9ec fix(api): detect IPv4-mapped IPv6 addresses at any zero-compressed offset
32e4879 docs(api): explain why the pre-loop address check cannot be removed
0cb3de4 docs(api): staging report — migration validated, two trigger bugs found
680cb6f feat(security): add per-key/company/IP rate limiting with 429 responses
e824e2d fix(api): guard nullable company_id and API-origin loop in migration triggers
3ca9507 docs(api): document rate limiting, body limits and redaction hardening
1c425ab merge: rate limiting, body limits and log redaction hardening
   ── fin del relevo anterior — bloque 1 de esta sesion desde aqui ──
ac4c221 feat(db): prepare performance indexes and document multi-event webhooks
c1c5ada feat(api): replicate the legacy deal stage write in a repository
08cf2e4 feat(api): expose PATCH /api/v1/deals/{id}/stage under deals:write
8f3df64 fix(api): write the stage activity metadata with numeric ids
49392f5 feat(api): retry safe network failures and record real send authorship
7e50075 docs(api): audit the delivery adapter and reaffirm the sender_id blocker
f61a2ca merge: deal stage write endpoint
4b9bfec merge: delivery adapter audit, safe retry and send audit trail
   ── bloque 2 de esta sesion desde aqui ──
7f832e6 docs(api): verify deal_activities/conversations/contact_tasks schema
4ade76c docs(api): verify operational gates live and consolidate readiness state
ce0958f feat(db): add a batched purge repository and scheduler for retention
fb64e30 feat(api): find or create a conversation without duplicating it
0d8bba0 feat(server): schedule retention purge and make its windows configurable
0311307 feat(api): expose POST /api/v1/conversations under conversations:write
9b99a02 docs(api): document the find-or-create conversation endpoint
a4b2686 feat(api): add updated_since filtering to contacts, conversations and messages
e82b352 feat(api): add GET /api/v1/messages/{id} for direct tenant-safe message reads
b1e1dd2 docs(api): audit openapi.yaml against real route behavior
1658f28 fix(api): filter messages by created_at, not a nonexistent updated_at
9a334f5 fix(api): route the tag param through the file's own validation helper
33f2d25 merge: retention purge for idempotency, outbox and webhook deliveries
9ae6571 merge: find-or-create conversation without duplicating it
f3b6080 merge: updated_since filters and direct message reads
9f5367b merge: audit openapi.yaml against real route behavior
b56ceac feat(config): add METRICS_ENABLED, disabled by default
77257aa feat(api): add GET /internal/metrics behind METRICS_ENABLED
e2a19d2 docs(api): document the metrics endpoint and why it ships disabled
8da92f1 docs(api): move METRICS-2026-08-13.md to the repo-root docs/api convention
dd74900 merge: operational metrics behind METRICS_ENABLED, off by default   <- HEAD
```

---

## Pruebas ejecutadas y resultados

Cada número verificado por mí de forma independiente (`npm test && npm run
typecheck && npm run build`, desde un `npm ci` limpio), nunca solo aceptado
del resumen de un agente:

| Punto | Tests | Typecheck | Build |
|---|---:|---|---|
| Inicio de la sesión (`1c425ab`) | 265 | limpio | limpio |
| Tras bloque 1 (deals + delivery + índices) | 313 | limpio | limpio |
| Tras retención | 327 | limpio | limpio |
| Tras conversación find-or-create | 337 | limpio | limpio |
| Tras `updated_since` + mensaje individual | 371 | limpio | limpio |
| Tras auditoría de contrato | — (313 en su rama, fusión sin cambios de test) | limpio | limpio |
| Tras métricas | **386** | **limpio** | **limpio** |

`npm ci` limpio corrido de nuevo justo antes de este documento, sobre el HEAD
final (`dd74900`): **386/386 pruebas, typecheck limpio, build limpio.**

---

## Riesgos abiertos reales

1. **Esquema de `deal_activities`**: cerrado (verificado, ver arriba).
2. **`sender_id=1` en el motor legacy**: sigue bloqueado, requiere decisión
   del propietario sobre tocar el bundle compilado. Documentado con
   precisión en `docs/api/DELIVERY-ADAPTER-AUDIT-2026-08-13.md`.
3. **`contact_tasks.assigned_to`**: confirmado texto libre sin poder
   validarse de forma fiable (valores reales de ejemplo: un email, un
   nombre de pila suelto). **Decisión pendiente del propietario**, no
   resuelta unilateralmente — ver `docs/api/SCHEMA-VERIFICATION-2026-08-13-02.md`
   sección 3.
4. **Regla de Nginx del prefijo `internal/` sin aplicar en el vhost real**
   (confirmado por lectura directa, no solo documentación). Bloquea de
   forma segura tanto `send-media` como el nuevo endpoint de métricas —
   ambos ya están desactivados por defecto por este mismo motivo.
5. **`002_performance_indexes.sql`**: preparado, verificado en staging dos
   veces (bloque 1 y re-verificación), **no aplicado en producción** —
   ejecución y decisión del propietario.
6. **`001_integration_api.sql`**: sigue sin aplicar en producción —
   decisión del propietario, con los dos bugs de trigger ya corregidos.
7. **Outbox sin `processed_at` para eventos con webhooks activos**:
   hallazgo del agente de retención — `integration_api_outbox.processed_at`
   solo se marca cuando NO hay ningún endpoint activo interesado en el
   evento, así que las filas de outbox que sí generan entregas nunca se
   marcan como procesadas y **la purga de retención nunca las alcanza** —
   crecerán sin límite para cualquier empresa con webhooks activos. No es
   un bug de esta sesión (es un comportamiento ya existente del worker de
   webhooks), pero el propietario debería considerar, en un cambio aparte,
   que el worker marque `processed_at` una vez todas las entregas de un
   evento alcancen estado terminal.
8. **Media proxy y métricas, mismos 5 pendientes operativos de siempre**
   antes de activarse: volumen escribible, regla de Nginx aplicada,
   alcanzabilidad del motor legacy, límites reales del proveedor, E2E
   autorizado (`docs/api/MEDIA-PROXY-2026-08-13.md`).

## Lo que quedó bloqueado únicamente por datos o decisiones tuyas

- **E2E bidireccional** (Bloque 5 del plan): necesito número de prueba de
  España, número de prueba de Chile, y la empresa piloto autorizada. No se
  ha tocado nada de esto.
- **Decisión sobre `sender_id=1`**: tocar o no el bundle compilado del CRM.
- **Decisión sobre `contact_tasks.assigned_to`**: validar por
  email/nombre con el riesgo de falsos negativos, o documentar
  explícitamente que es texto libre sin garantía.
- **Aplicar `001_integration_api.sql` y `002_performance_indexes.sql`** en
  producción: preparados, verificados, a la espera de tu ejecución.
- **Activar `send-media`, el proxy de media o las métricas**: código listo
  y probado, desactivado por defecto hasta que decidas completar los pasos
  operativos (Nginx, volumen, red).

## Qué queda listo para GitHub

Todo lo de la tabla de commits de arriba: 53 commits locales, ninguno
empujado, ninguna migración aplicada en producción, ningún contenedor
tocado, producción verificada intacta al cierre de este documento (health
200, ready 200, `crm.zinto.app/inbox` 200, revisión desplegada sigue en
`3417c32`, sin cambios). Sin residuos de staging (contenedor y volumen
destruidos tras cada uso, verificado).
