# Relevo para Claude: Zinto Integration API

Usa este documento como prompt y contexto operativo. Trabaja sobre el
repositorio `https://github.com/Bcousino890/zinto-app`, rama
`codex/integration-api-v1`. No borres ni reemplaces el CRM compilado existente.

## Objetivo del propietario

Construir una API publica, universal y 100% bidireccional para que empresas
como SmartBC integren Zinto sin que Zinto se adapte a cada cliente. Un sistema
externo debe poder gestionar contactos, elegir canal, enviar y recibir
mensajes, consultar historial completo, notas, etiquetas, pipelines,
oportunidades y tareas. Los cambios hechos en Zinto deben aparecer fuera por
webhook y los cambios externos deben persistir en Zinto. Toda entrega terminada
debe quedar desplegada en el VPS y respaldada en GitHub.

## Propiedad y limitacion actual

El VPS es del propietario y contiene la aplicacion operativa, datos y
configuracion. Del CRM activo solo se recupero el compilado `dist/`; no se
encontro el TypeScript original. No significa que el servicio dependa
tecnicamente del antiguo desarrollador para ejecutarse, pero si que el fuente
mantenible debe reconstruirse gradualmente. No afirmar propiedad juridica sin
revisar el contrato. La nueva API si se esta creando con fuente completo.

## Produccion conocida

- Dominio: `crm.zinto.app`
- VPS: Hostinger, acceso root administrado por el propietario. Solicita las
  credenciales de forma segura; no las escribas en Git ni en respuestas.
- CRM bueno: contenedor `powerchat-app-bcousinoprop`, puerto 9000.
- PostgreSQL bueno: `powerchat-postgres-bcousinoprop`, PostgreSQL 16.
- Red Docker compartida: `powerchat-shared-network`.
- Nginx: `crm.zinto.app` envia `/` a `127.0.0.1:3001` y
  `/api/webhooks/` a `127.0.0.1:4001`.
- Preview de la API: contenedor `zinto-integration-api-preview`, localhost
  3100, prefijo `/_integration-api/`.
- No tocar repositorios/codigo `multizap`, GitHub antiguo ni `empresa01` para
  esta tarea. La fuente de verdad funcional es bcousinoprop/Zinto.

## Estado implementado

El servicio independiente esta en `integration-api/` con Node 22, TypeScript,
Fastify, PostgreSQL y Zod. No abre otra sesion Baileys: los envios se delegan al
motor existente por HTTP para mantener un unico propietario de WhatsApp.

Implementado y probado:

- `/health`, `/ready`, request IDs y errores canonicos.
- API keys legacy compatibles `pcp_<64 hex>`; el hash SHA-256 se calcula solo
  sobre el sufijo despues de `pcp_`.
- aislamiento por `company_id` derivado de la clave, scopes, expiracion, estado
  e IP permitida.
- `GET /api/v1/me`, canales, contactos, conversaciones e historial completo de
  mensajes con cursores, sin filtro por dia actual.
- escritura tenant-safe de contactos, notas y etiquetas.
- idempotencia transaccional para creaciones/envios.
- envio de texto, media, plantillas e interactivos segun capacidades del canal.
- outbox y webhooks HMAC-SHA256 con secretos AES-256-GCM, leasing y reintentos.
- migracion `001_integration_api.sql` con tablas y triggers de eventos.
- OpenAPI 3.1 y documentacion para partners en `integration-api/docs/`.
- ejemplos TypeScript en `integration-api/examples/`.
- modo `READ_ONLY_MODE=true` y worker apagado por defecto.
- Docker/Nginx de preview con doble bloqueo de escrituras.

Commits relevantes hasta el relevo:

- `33d926d` documentacion de recuperacion y arquitectura.
- `e2208d7` base del servicio.
- `ce71fcf` autenticacion.
- `f611c67` recursos de lectura.
- `8c909a0` contactos, notas y tags.
- `ba06f49` entrega multicanal.
- `a5f6ab9` webhooks bidireccionales.
- `51c32dc` contrato OpenAPI y documentacion.

## Reglas de seguridad obligatorias

1. No imprimir, registrar ni commitear `DATABASE_URL`, contrasenas, API keys,
   cookies, sesiones WhatsApp, claves de cifrado ni datos de clientes.
2. No aplicar la migracion en produccion hasta probar backup y rollback en un
   clon/staging de PostgreSQL.
3. No habilitar `READ_ONLY_MODE=false` ni el worker hasta completar auditoria
   de tenant isolation, SSRF, idempotencia y compatibilidad con el motor legacy.
4. No sustituir `/api/v1` del CRM. Mantener prefijo dedicado o migrar despues a
   un hostname especifico con compatibilidad planificada.
5. No iniciar una segunda conexion QR/Baileys para un canal ya operado por el
   CRM.
6. Toda consulta y mutacion debe filtrar la empresa obtenida de la clave y
   validar tambien la empresa de recursos relacionados.
7. Usar TDD: prueba roja, implementacion minima, suite completa, typecheck y
   build antes de commit.
8. Antes de desplegar: backup verificable, `nginx -t`, health/readiness, smoke
   del CRM existente y rollback documentado.

## Pendientes prioritarios

1. Confirmar el preview desplegado y revisar logs sin secretos.
2. Endurecer SSRF de `media_url` y webhooks: resolver DNS en cada conexion,
   bloquear rangos privados/reservados IPv4/IPv6 y redirecciones a destinos no
   seguros. La validacion actual del webhook no resuelve DNS.
3. Crear staging o clon anonimizado y aplicar/revertir la migracion alli.
4. Auditar el adaptador legacy: algunas rutas antiguas atribuyen envios al
   usuario 1. Corregir autoria antes de escrituras publicas.
5. Agregar rate limits, limites de cuerpo, CORS si corresponde, metricas,
   retention/limpieza de idempotencia y outbox, y alertas.
6. Implementar lectura/escritura de pipelines, etapas, oportunidades/deals y
   tareas con aislamiento tenant estricto; agregar sus eventos reales.
7. Agregar creacion/seleccion explicita de conversacion y busqueda incremental
   (`updated_since`) para reconciliacion eficiente.
8. Probar de extremo a extremo mensajes entrantes/salientes en canales Espana
   y Chile con numeros de prueba autorizados, incluyendo estados y multimedia.
9. Generar una API key de staging de alcance minimo y ejecutar contract tests
   contra `crm.zinto.app/_integration-api` sin revelar la clave.
10. Ejecutar revisiones independientes de seguridad, contrato OpenAPI,
    rendimiento SQL y despliegue; corregir hallazgos altos antes de activar
    escrituras.
11. Publicar version, changelog y procedimiento de rotacion de claves; despues
    abrir PR y fusionar solo con suite verde.

## Comandos de verificacion local

```bash
cd integration-api
npm ci
npm test
npm run typecheck
npm run build
git diff --check
```

## Criterio de API 100% terminada

No declares la API completa solo porque el preview responda. Deben existir en
OpenAPI, implementacion y pruebas E2E: contactos, canales, conversaciones,
historial, mensajes en ambas direcciones, media, notas, tags, pipelines,
etapas, deals, tareas, webhooks, estados de entrega, idempotencia, paginacion,
autenticacion, limites, auditoria, observabilidad, recuperacion y documentacion
para terceros. Finalmente verifica en GitHub y VPS que ejecutan el mismo commit.

## Instruccion principal para Claude Code

Actua como ingeniero principal responsable de continuidad, seguridad y
operacion. No empieces reescribiendo. Primero clona la rama, lee todos los
documentos y ejecuta la suite. Compara este relevo con el codigo real; si hay
una diferencia, el codigo y las pruebas del commit desplegado son evidencia,
pero no cambies comportamiento sin comprender por que. Mantiene un diario de
decisiones en `docs/api/` y realiza commits pequenos, verificables y reversibles.

No preguntes al propietario cuestiones que puedas comprobar de manera segura.
Si una accion puede perder datos, interrumpir WhatsApp, modificar produccion o
exponer secretos, detente, presenta exactamente el riesgo y usa primero staging
o una transaccion con rollback. Nunca uses `git reset --hard`, nunca borres el
CRM compilado y nunca sustituyas los contenedores actuales.

## Inventario preciso del repositorio

| Ruta | Responsabilidad |
| --- | --- |
| `README.md` | Explica que el repositorio es una recuperacion y no el fuente original completo |
| `docs/CURRENT-PRODUCTION-STATE-2026-08-13.md` | Evidencia de lo recuperado del VPS |
| `docs/api/INTEGRATION-API-DESIGN.md` | Arquitectura y alcance propuesto |
| `integration-api/src/app.ts` | Construccion Fastify, health, readiness y bloqueo read-only |
| `integration-api/src/config.ts` | Validacion estricta de variables de entorno |
| `integration-api/src/server.ts` | Composicion de repositorios, pool, adapter y worker |
| `integration-api/src/auth/` | API keys y scopes |
| `integration-api/src/resources/` | SQL tenant-safe para lectura y contactos/notas/tags |
| `integration-api/src/routes/` | Contrato HTTP y validacion Zod |
| `integration-api/src/delivery/` | Adaptador al motor legacy y comprobacion inicial de media URL |
| `integration-api/src/webhooks/` | cifrado, firma, outbox, leasing, reintentos y worker |
| `integration-api/migrations/001_integration_api.sql` | DDL y triggers; NO aplicada por el preview |
| `integration-api/openapi/openapi.yaml` | Contrato publico OpenAPI 3.1, fuente de verdad para partners |
| `integration-api/docs/` | Guias consumibles por integradores |
| `integration-api/test/` | Pruebas de contrato, aislamiento y comportamiento |
| `integration-api/deploy/` | Compose/Nginx de preview y rollback |
| `integration-api/Dockerfile` | Build multi-stage y runtime como usuario `node` |

## Arquitectura y limites de confianza

```text
Partner/SmartBC
      |
      | HTTPS + Bearer pcp_* + Idempotency-Key
      v
Nginx crm.zinto.app
      |
      | /_integration-api/* solamente
      v
zinto-integration-api-preview :3100
      |                         |
      | SQL tenant-safe         | HTTP interno para entrega (futuro write mode)
      v                         v
PostgreSQL CRM            powerchat-app-bcousinoprop:9000
      |
      | outbox transaccional (despues de migracion)
      v
Webhook worker -> endpoint HTTPS del partner
```

Limites de confianza:

- Nginx no autentica; la API valida cada Bearer token.
- El cliente nunca es confiable para `company_id`, IDs relacionados, URLs,
  scopes, autoria o capacidad del canal.
- PostgreSQL es la fuente de verdad de entidades e historial.
- El CRM compilado es el unico propietario actual de sesiones WhatsApp/QR.
- El proveedor de canal puede aceptar una entrega aunque el HTTP termine en
  timeout; por eso `504` es estado ambiguo y no se reintenta automaticamente.
- Los destinos de media y webhook son entrada no confiable y requieren defensa
  SSRF completa antes de habilitar escrituras.

## Contrato de autenticacion exacto

La expresion aceptada es `^Bearer (pcp_[a-f0-9]{64})$`. El sistema legacy
almacena `SHA256` de los 64 caracteres posteriores a `pcp_`, no de la cadena
completa. Este detalle ya causo un error durante la reconstruccion y esta
cubierto por pruebas. No lo cambies sin migracion de claves.

Flujo de autenticacion:

1. Extraer Bearer con formato exacto.
2. Calcular `sha256(rawKey.slice(4))`.
3. Buscar en `api_keys` y relacionar empresa/usuario.
4. Rechazar clave inexistente, inactiva o expirada.
5. Si `allowed_ips` no esta vacio, exigir coincidencia con `request.ip`.
6. Decorar el request con `apiKeyId`, `companyId`, `companyName`, `userId` y
   scopes.
7. Actualizar fecha de ultimo uso sin registrar la clave.
8. Cada ruta comprueba scopes; `*` satisface todos.

Codigos esperados: `missing_api_key`, `invalid_api_key`, `api_key_inactive`,
`api_key_expired`, `ip_not_allowed`, `insufficient_scope`.

## Operaciones implementadas en 0.1.0

| Metodo y ruta interna | Scope | Observaciones |
| --- | --- | --- |
| `GET /health` | publico | Liveness, no comprueba DB |
| `GET /ready` | publico | Ejecuta comprobacion de dependencia DB |
| `GET /api/v1/me` | clave valida | Empresa, nombre de clave y scopes |
| `GET /api/v1/channels` | `channels:read` | Sin credenciales del proveedor; incluye capacidades |
| `GET /api/v1/contacts` | `contacts:read` | Cursor estable, maximo 200 |
| `POST /api/v1/contacts` | `contacts:write` | Exige idempotencia; bloqueado en preview |
| `PATCH /api/v1/contacts/:id` | `contacts:write` | Valida empresa en SQL |
| `DELETE /api/v1/contacts/:id` | `contacts:write` | Archivo logico, no borrado fisico |
| `POST /api/v1/contacts/:id/notes` | `notes:write` | Exige idempotencia y contacto de la empresa |
| `PATCH /api/v1/notes/:id` | `notes:write` | Join tenant-safe |
| `DELETE /api/v1/notes/:id` | `notes:write` | Join tenant-safe |
| `PUT /api/v1/contacts/:id/tags/:tag` | `tags:write` | Adjunta sin duplicar |
| `DELETE /api/v1/contacts/:id/tags/:tag` | `tags:write` | Quita de forma idempotente |
| `GET /api/v1/conversations` | `conversations:read` | Cursor estable |
| `GET /api/v1/conversations/:id/messages` | `conversations:read` + `messages:read` | Todos los dias persistidos |
| `POST /api/v1/messages/send` | `messages:send` | texto, idempotente |
| `POST /api/v1/messages/send-media` | `messages:send` | media; SSRF pendiente de endurecer |
| `POST /api/v1/messages/send-template` | `messages:send` | solo canal con `template` |
| `POST /api/v1/messages/send-interactive` | `messages:send` | solo canal con `interactive` |
| `POST /api/v1/webhooks` | `webhooks:manage` | secreto visible una vez; bloqueado en preview |
| `GET /api/v1/webhooks` | `webhooks:manage` | requiere tablas de migracion |
| `DELETE /api/v1/webhooks/:id` | `webhooks:manage` | desactiva; bloqueado en preview |

La URL externa agrega `https://crm.zinto.app/_integration-api`. El proxy quita
ese prefijo al enviarlo al servicio. No dupliques el prefijo en Fastify.

## Respuestas, cursores e idempotencia

Toda respuesta normal incluye `meta.request_id` y encabezado `X-Request-Id`.
Toda respuesta de error usa:

```json
{"error":{"code":"stable_machine_code","message":"human text","request_id":"req_uuid"}}
```

Los cursores son Base64URL de `{id, createdAt}` pero son opacos para el cliente.
Ordenar por fecha e ID para evitar saltos/duplicados. Nunca volver a paginacion
por offset para historiales activos.

La idempotencia se delimita por `apiKeyId + method + route template + key`. El
hash del request usa JSON estable con claves ordenadas. Una repeticion identica
devuelve la respuesta persistida y `Idempotent-Replayed: true`; un cuerpo
distinto devuelve `409 idempotency_conflict`. PostgreSQL usa advisory lock por
alcance para serializar solicitudes concurrentes. Revisar limpieza de registros
expirados antes de produccion write-enabled.

## Modelo de canal y entrega

Mapa actual de capacidades:

- `whatsapp` y `whatsapp_unofficial`: `text`, `media`.
- `whatsapp_official`: `text`, `media`, `template`, `interactive`.
- `whatsapp_meta`: `text`, `media` segun el motor recuperado.
- Otros canales no deben recibir tipos no declarados.

Antes de enviar:

1. Autenticar y exigir `messages:send`.
2. Validar cuerpo estricto, sin campos desconocidos.
3. Consultar canal usando la empresa de la clave.
4. Exigir estado `active` o `connected`.
5. Exigir capacidad correspondiente.
6. Validar URL si hay media.
7. Adquirir idempotencia antes de llamar al legacy.
8. Delegar por HTTP con la misma clave, nunca crear socket WhatsApp nuevo.
9. Normalizar resultado sin exponer respuesta interna.
10. Para timeout guardar/retornar `504 delivery_timeout` ambiguo; no retry
    automatico.

## Webhooks y outbox

Firma: `v1=hex(HMAC_SHA256(secret, timestamp + "." + rawBody))`.
Encabezados: `X-Zinto-Event-Id`, `X-Zinto-Timestamp`, `X-Zinto-Signature`.
El cuerpo contiene `id`, `type`, `schema_version: 1`, `occurred_at`, `data`.

La migracion crea:

- `integration_api_idempotency`;
- `integration_api_audit_records`;
- `integration_api_outbox`;
- `integration_api_webhook_endpoints`;
- `integration_api_webhook_deliveries`;
- indices parciales para pendientes y expiracion;
- triggers sobre contactos, notas, conversaciones, mensajes y estado de canal.

Los secretos se cifran AES-256-GCM y se almacena hash separado. El dispatcher
reclama lotes, usa timeout 15 s, considera cualquier `2xx` entregado, y aplica
backoff exponencial con jitter hasta 10 intentos; despues marca `dead`. Los
consumidores deben deduplicar por ID porque la entrega es al menos una vez.

Antes de aplicar la migracion, verificar con esquema real todos los nombres de
columnas, tipos y FKs. Ya fue compilada dentro de una transaccion que termino en
`ROLLBACK` contra produccion y se probo temporalmente un trigger de contacto
tambien con rollback; eso no sustituye staging ni backup restaurable.

## Secuencia exacta para continuar

### Fase A: orientacion y reproducibilidad

1. Clonar la rama en directorio limpio.
2. Ejecutar `git status --short` y exigir limpio.
3. Leer este relevo, OpenAPI, design y produccion state.
4. Ejecutar `npm ci`, tests, typecheck, build y `git diff --check`.
5. Registrar commit exacto con `git rev-parse HEAD`.
6. Comprobar que VPS y GitHub usan ese mismo commit mediante un archivo de
   release o label de imagen; no asumir por nombre de imagen.

### Fase B: seguridad bloqueante

1. Escribir primero pruebas SSRF para A/AAAA publicos, loopback, link-local,
   RFC1918, CGNAT, multicast, unspecified, IPv4-mapped IPv6, rebinding y cada
   redirect.
2. Implementar un fetch seguro que resuelva/fije destino por salto o prohiba
   redirects; no basta validar hostname una vez y luego usar `fetch` normal.
3. Aplicar el mismo componente a media y webhooks.
4. Agregar limites por API key/empresa/IP y `Retry-After`.
5. Configurar limites de body distintos para JSON; media debe llegar por URL o
   almacenamiento controlado, no buffers ilimitados.
6. Revisar logs y redaction incluyendo query strings, cuerpos y errores del
   proveedor.
7. Ejecutar auditoria multi-tenant intentando IDs de otra empresa en cada ruta.

### Fase C: staging de base de datos

1. Crear dump cifrado o snapshot del PostgreSQL correcto.
2. Restaurar en instancia aislada; si contiene clientes, restringir acceso y
   anonimizar para desarrolladores.
3. Medir tamaño/tablas y guardar checksum del backup.
4. Aplicar `001_integration_api.sql` en staging.
5. Ejecutar pruebas de insert/update/delete por entidad y comprobar exactamente
   un evento por cambio, empresa correcta y payload sin secretos.
6. Probar rollback restaurando desde el backup, no solo ejecutando `ROLLBACK`.
7. Ejecutar `EXPLAIN (ANALYZE, BUFFERS)` con volumen representativo para listas
   e historial; agregar indices solo con evidencia.

### Fase D: completar recursos

Para pipeline, etapas, deals y tareas: primero inspecciona esquema real y
semantica del compilado. Define recursos canonicamente en OpenAPI, escribe
pruebas tenant-safe, implementa repositorio SQL propio, agrega auditoria/outbox
y finalmente rutas. No delegues CRUD al legacy si sus rutas no filtran empresa.

Agregar como minimo:

- lista/creacion/actualizacion/archivo de pipelines y etapas si el modelo lo
  permite;
- deals con cambio de etapa atomico y evento `deal.stage.changed`;
- tareas con asignacion validada dentro de empresa y evento de completado;
- conversaciones: crear/obtener por contacto+canal y evitar duplicados;
- notas y tags de conversacion si existen separadas de contacto;
- filtros incrementales por `updated_since` con orden determinista;
- endpoints de estado/reconciliacion de mensajes.

### Fase E: E2E bidireccional

Usa empresas y numeros de prueba autorizados, nunca clientes al azar.

1. Crear contacto externo y comprobarlo en Zinto.
2. Editarlo en Zinto y recibir webhook externo.
3. Seleccionar cada canal de Espana y Chile por ID obtenido de `/channels`.
4. Enviar texto externo, verlo en Zinto y recibirlo en WhatsApp.
5. Responder desde WhatsApp y verlo en Zinto y partner.
6. Repetir con imagen, video, audio y documento dentro de limites reales del
   proveedor.
7. Probar template/interactivo solo en canales compatibles.
8. Probar nota/tag/pipeline/deal/tarea en ambas direcciones.
9. Probar mensajes de dias anteriores y chats antes vacios.
10. Probar desconexion/reconexion de canal y webhook de estado.
11. Probar timeout, duplicado, evento repetido, orden invertido y caida temporal
    del receptor.

### Fase F: habilitacion gradual

1. Mantener preview GET-only hasta resolver hallazgos altos.
2. Habilitar migracion con ventana, backup y observacion.
3. Activar worker primero para un endpoint interno controlado.
4. Habilitar una sola clave/empresa piloto y scopes minimos.
5. Permitir escrituras en Nginx y `READ_ONLY_MODE=false` solo para piloto.
6. Observar errores, latencia, lag de outbox, dead letters y duplicados.
7. Expandir por empresas/scopes; cada paso debe poder revertirse sin perder
   eventos.

## Pruebas que no pueden faltar

- autenticacion: formato, hash legacy, inactiva, expirada, IP, scope y `*`;
- aislamiento: cada ID valido de otra empresa devuelve no encontrado;
- cursor: limites, invalido, empate de timestamps y pagina final;
- historial: mensajes de multiples dias, vacio real y conversacion ajena;
- idempotencia: faltante, replay, conflicto y dos requests concurrentes;
- canal: ajeno, inactivo y capacidad incompatible;
- delivery: exito, rechazo, timeout ambiguo y respuesta malformada;
- SSRF: DNS/IPv4/IPv6/redireccion/rebinding para media y webhook;
- webhook: firma exacta raw body, secreto una vez, retry, dead, lease vencido,
  endpoint desactivado y duplicado;
- outbox: evento exactamente una vez en la transaccion y empresa correcta;
- read-only: todo verbo mutante bloqueado tanto directa como externamente;
- despliegue: contenedor no-root/read-only, localhost bind, health/readiness,
  Nginx valido, CRM original sano y rollback real.

## Auditorias independientes solicitadas

Antes de llamar a la version write-enabled, solicita al menos cuatro revisiones
separadas, sin compartir conclusiones iniciales para reducir sesgo:

1. Seguridad: auth, tenant isolation, SSRF, secretos, rate limit, SQL y webhook.
2. Contrato: OpenAPI vs rutas/cuerpos/status/scopes y experiencia de partner.
3. Datos: DDL, triggers, transacciones, indices, retencion y restauracion.
4. Operacion: Docker, Nginx, observabilidad, rollout, rollback y convivencia con
   el CRM compilado.

Cada hallazgo debe incluir severidad, evidencia, archivo/linea, reproduccion y
prueba de regresion. Corregir criticos/altos antes de produccion. Reejecutar una
revision final, no confiar solo en la declaracion del autor del cambio.

## Checklist de release

- [ ] Worktree limpio y commit identificado.
- [ ] Suite completa sin fallos, typecheck y build verdes.
- [ ] OpenAPI valida y coincide con todas las rutas publicas.
- [ ] Sin secretos ni datos de clientes en diff, imagen o logs.
- [ ] Backup creado, checksum guardado y restauracion demostrada.
- [ ] Migracion probada en staging y plan de rollback ensayado.
- [ ] Auditorias independientes sin criticos/altos abiertos.
- [ ] Imagen construida por digest y vinculada al commit.
- [ ] `docker compose config` valido.
- [ ] `nginx -t` valido antes de reload.
- [ ] Health y readiness responden.
- [ ] Login/inbox/administracion del CRM original siguen funcionando.
- [ ] Prueba E2E autorizada confirma ambos sentidos.
- [ ] Metricas, logs, alertas y responsable de guardia definidos.
- [ ] GitHub contiene exactamente la version desplegada.
- [ ] Changelog, OpenAPI y guias actualizados.

## Condiciones de parada inmediata

Deten el rollout y vuelve a read-only si ocurre cualquiera:

- acceso o respuesta con datos de otra empresa;
- perdida/duplicacion no explicada de mensajes;
- segundo socket compitiendo por una sesion WhatsApp;
- crecimiento descontrolado de outbox/deliveries;
- errores repetidos del CRM original tras Nginx/reload;
- secretos en logs o respuestas;
- backup no restaurable;
- migracion bloqueando tablas o degradando consultas;
- discrepancia entre commit de GitHub y artefacto del VPS.

## Formato de reporte al propietario

En cada entrega informa con lenguaje claro:

1. Que funciona realmente y que sigue pendiente.
2. Commit y rama de GitHub.
3. Artefacto/commit desplegado en VPS.
4. Pruebas ejecutadas con numero de casos y resultado.
5. Pruebas E2E realizadas y datos de prueba autorizados usados.
6. Riesgos abiertos y si el modo sigue read-only.
7. Pasos exactos de rollback.

No digas "API 100% lista" mientras falten recursos, auditorias o E2E. La
transparencia es mas importante que cerrar rapido.
