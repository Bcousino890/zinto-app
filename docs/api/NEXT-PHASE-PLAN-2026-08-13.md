# Plan de la siguiente fase

Fecha: 13 de agosto de 2026
Punto de partida: `3417c32` (GitHub y VPS coinciden, preview read-only)
Complementa el runbook `docs/CLAUDE-HANDOFF-INTEGRATION-API-2026-08-13.md`.

Orden recomendado. Los bloques 1 a 3 son bloqueantes de seguridad y datos; el 4
y el 5 no deben empezarse antes de tener staging, porque implican escrituras.

---

## Bloque 1 — Cerrar el riesgo residual de media (IMPLEMENTADO, desactivado)

**Estado:** la opcion B se implemento completa. Detalle en
`docs/api/MEDIA-PROXY-2026-08-13.md`. La API descarga la media con `safe-fetch`
(pinning real de socket), la guarda con nombre aleatorio de 256 bits y entrega
al motor legacy solo una URL interna; el motor nunca ve la direccion del
partner. 16 pruebas, incluida una de extremo a extremo. Desactivado por
defecto (`MEDIA_PROXY_ENABLED=false`) y con fallo cerrado si se activa sin la
variable de destino interno.

**La auditoria del motor legacy confirmo por que esto era necesario, con mas
gravedad de la asumida:** `LEGACY-ENGINE-AUDIT-2026-08-13.md` (pregunta 3)
verifico que la descarga de salida en ambos canales de WhatsApp no tiene
**ninguna** defensa — sin resolucion previa, sin `maxRedirects`, sin limite de
tamano, sigue redirecciones con el limite por defecto de la libreria (21
saltos). Lo notable: las rutas de **entrada** de media del mismo motor si estan
bien endurecidas (lookup fijado, `maxRedirects:0`, limite de tamano) — el
patron correcto existe en su propio codigo, simplemente no se aplico a la
salida. Confirma que nuestro proxy no es una precaucion excesiva: es la unica
defensa real en toda la cadena para `send-media`.

**Pendiente antes de activar** (sin cambios respecto a `MEDIA-PROXY-2026-08-13.md`):
volumen escribible para el contenedor read-only, aplicar la regla de Nginx que
deniega `/_integration-api/internal/` (escrita pero no aplicada en el vhost),
confirmar alcance de red del motor legacy al host interno, ajustar
`MEDIA_MAX_BYTES` a limites reales del proveedor, y E2E autorizado.

---

## Bloque 2 — Limites, redaction y observabilidad (Fase B.4/B.5/B.6)

Pendiente del runbook aun abierto. No requiere staging y reduce riesgo de
inmediato.

1. Rate limit por clave, empresa e IP, con `429` y `Retry-After`.
2. Limites de cuerpo diferenciados por ruta; JSON acotado.
3. Revision de redaction: hoy se redactan `authorization` y `cookie`, pero falta
   auditar query strings, cuerpos de peticion y errores del proveedor legacy,
   que pueden arrastrar datos de cliente.
4. Metricas: latencia por ruta, tasa de error, y una vez activo el worker, lag
   de outbox, dead letters y duplicados.
5. Retencion y limpieza de idempotencia y outbox.

---

## Bloque 3 — Staging con backup restaurable (Fase C, bloqueante)

**No aplicar la migracion en produccion hasta completar esto.**

1. Dump cifrado del PostgreSQL correcto (`powerchat-postgres-bcousinoprop`),
   con checksum guardado aparte.
2. Restaurar en una instancia aislada. Contiene datos de clientes reales: acceso
   restringido y anonimizacion antes de exponerlo a cualquier desarrollador.
3. Aplicar `001_integration_api.sql` alli y medir el tiempo de bloqueo real.
4. Probar insert/update/delete por entidad y comprobar exactamente un evento por
   cambio, con la empresa correcta y sin secretos en el payload.
5. **Probar el rollback restaurando desde el backup**, no solo con `ROLLBACK`.
6. `EXPLAIN (ANALYZE, BUFFERS)` sobre listados e historial con volumen
   representativo; anadir indices solo con evidencia.

**Volumen actual observado** (util para dimensionar): 17 pipelines, 125 etapas,
513 deals, 2 tareas.

---

## Bloque 4 — CRUD de pipelines, etapas, deals y tareas (Fase D)

La mitad de lectura ya esta implementada (ver
`docs/api/PIPELINE-RESOURCES-2026-08-13.md`). Lo que sigue es sobre la mitad de
escritura, hasta ahora bloqueada por incertidumbre. Esa incertidumbre **ya se
resolvio**: `docs/api/LEGACY-ENGINE-AUDIT-2026-08-13.md` audito el bundle
compilado en marcha (verificado byte a byte contra el contenedor de
produccion) y establecio con confianza alta que columnas escribir.

### Trampa 1 (RESUELTA): `deals.stage` y `deals.stage_id` son vocabularios distintos

Confirmado por auditoria de codigo, no solo por los datos: el CRM **lee
`stage_id` casi en exclusiva** — tablero, filtros y paginacion son 100 %
`stage_id` — y `stage` es un texto heredado que casi nadie lee, alimentado por
dos mapeadores incoherentes (por subcadena y por diccionario exacto) que
colapsan nombres de etapa en espanol como "Arrived" o "Envio prop" al valor por
defecto `"lead"`. Ese es el mecanismo exacto detras de la divergencia observada
en los 513 deals reales.

**Regla de escritura, ya especificada, no queda a interpretar:**

1. Validar que la etapa destino pertenece al mismo `pipeline_id` del deal antes
   de escribir; si no, es error, no un movimiento entre pipelines.
2. Escribir **siempre** `stage_id` y `stage` juntas, en la misma transaccion.
3. `stage` se calcula replicando el mapeador por subcadena del motor, literal,
   incluido su orden de comprobaciones (tiene un fallo conocido: una etapa
   llamada "Closed Lost" mapea a `closed_won` porque comprueba `"closed"` antes
   que `"lost"` — replicarlo de todas formas, para no divergir mas del motor).
4. Insertar una fila en `deal_activities` con `type: 'stage_change'`, como hace
   el motor, usando el usuario real de la integracion en vez de su respaldo
   `assigned_to_user_id || 1`.
5. Nunca escribir `stage` sin `stage_id`: es exactamente lo que hace la unica
   ruta del motor que desincroniza mas las dos columnas.
6. Respetar la regla de negocio de un solo deal activo por contacto y pipeline
   antes de mover un deal entre pipelines (el motor responde `409`).

El SQL exacto y el detalle completo estan en la seccion "Conclusion practica"
de `LEGACY-ENGINE-AUDIT-2026-08-13.md`. Implementar `deal.stage.changed`
siguiendo eso, con pruebas TDD antes del codigo.

### Trampa 2: `company_id` es NULL-able en `pipelines` y `pipeline_stages`

Hoy no hay ninguna fila con `company_id` nulo (0 de 17 y 0 de 125), pero la
columna lo permite y el modelo contempla plantillas (`is_template`,
`template_category`). Un filtro ingenuo del tipo
`company_id = $1 OR company_id IS NULL` filtraria plantillas entre empresas en
cuanto aparezca la primera fila global.

**Regla:** filtrar siempre por `company_id = $1` estricto. Si se decide exponer
plantillas globales, que sea por un recurso distinto y explicito, nunca mezclado
en el listado de la empresa.

Ademas, `pipeline_stages` tiene `company_id` y `pipeline_id`: hay que validar que
el pipeline pertenece a la empresa **y** que la etapa pertenece a ese pipeline,
para evitar confusion de IDs.

### Trampa 3: `contact_tasks.assigned_to` es `text`, no una FK de usuario

El runbook pide "tareas con asignacion validada dentro de empresa", pero la
columna es texto libre y los 2 valores existentes no son IDs numericos. No se
puede validar por clave foranea.

**Decision requerida del propietario:** o se valida contra usuarios de la empresa
resolviendo por nombre/email, o se documenta explicitamente que el campo es
libre y la API no garantiza que el asignado exista.

### Secuencia de trabajo del bloque

Para cada recurso, en este orden y nunca al reves:

1. Inspeccionar esquema y semantica real del compilado en staging.
2. Definir el recurso en OpenAPI.
3. Escribir pruebas tenant-safe primero, incluidas las de ID ajeno.
4. Implementar repositorio SQL propio con filtro estricto por empresa.
5. Anadir auditoria y outbox.
6. Exponer las rutas.

No delegar el CRUD al legacy si sus rutas no filtran por empresa.

### Bloqueante de autoria (RESUELTO por auditoria, sigue bloqueando escrituras)

El runbook decia "algunas rutas antiguas atribuyen los envios al usuario 1"; la
auditoria establecio que es **peor y mas preciso**: las cuatro rutas de envio,
en todos los canales, escriben `sender_id = 1` como literal incrustado en el
bundle compilado. No puede corregirse desde nuestra API porque el problema esta
en el motor legacy al que delegamos el envio (`src/delivery/client.ts`), no en
nuestro codigo. El middleware de autenticacion del CRM carga
`api_keys.user_id` pero nunca lo propaga a la request, asi que ni siquiera es
posible que el motor derive el autor real aunque quisiera.

Caso aparte: `send-media` sobre `whatsapp_official` (el canal principal) no
escribe `sender_id = 1`, sino `sender_id = NULL, is_from_bot = true` — marca el
mensaje como de bot en vez de atribuirlo a nadie. Son dos defectos distintos con
dos arreglos distintos.

**Esto bloquea habilitar `messages:send` para un partner real:** cada mensaje
que un partner envie por la API aparecera en el CRM como enviado por el
usuario 1 (o como bot, en el caso de whatsapp_official), nunca por la
integracion. Cualquier auditoria o soporte que dependa de saber quien envio un
mensaje quedara ciega para trafico via API.

**El arreglo esta identificado y es pequeno** (detalle completo en
`LEGACY-ENGINE-AUDIT-2026-08-13.md`, pregunta 1): el middleware ya tiene el
`user_id` en memoria, solo falta propagarlo (`r.userId = o.userId`) y sustituir
los ~14 literales `1` en `XL.sendThroughChannel` / `XL.sendMediaThroughChannel`
por ese valor. Pero es una modificacion al **bundle compilado en produccion**,
sin fuente TypeScript original, sin tests de caracterizacion y sin build
reproducible. No es un cambio para hacer a ciegas ni para incluir en esta rama
sin decision explicita del propietario sobre como intervenir codigo compilado
que ya sirve trafico real. Queda como bloqueante formal, con la causa raiz y la
correccion exacta ya documentadas, a la espera de esa decision.

Anadir tambien: creacion/seleccion explicita de conversacion por contacto+canal
sin duplicados, filtros `updated_since` con orden determinista, y endpoints de
estado/reconciliacion de mensajes.

---

## Bloque 5 — E2E bidireccional real (Fase E)

**Requiere del propietario:** numeros de prueba autorizados de Espana y Chile, y
una empresa piloto. No usar clientes al azar.

Cobertura minima: contacto en ambos sentidos; texto saliente y entrante por cada
canal obtenido de `/channels`; imagen, video, audio y documento dentro de los
limites reales del proveedor; plantilla e interactivo solo en canales
compatibles; nota, tag, pipeline, deal y tarea en ambos sentidos; mensajes de
dias anteriores y chats antes vacios; desconexion y reconexion de canal;
timeout, duplicado, evento repetido, orden invertido y caida temporal del
receptor.

Precondicion: el bloque 1 debe estar cerrado antes de probar media hacia
terceros.

---

## Bloque 6 — Auditorias independientes

Cuatro revisiones separadas, sin compartir conclusiones iniciales entre ellas
para reducir sesgo:

1. **Seguridad:** auth, aislamiento, SSRF, secretos, rate limit, SQL, webhook.
2. **Contrato:** OpenAPI frente a rutas, cuerpos, status y scopes.
3. **Datos:** DDL, triggers, transacciones, indices, retencion y restauracion.
4. **Operacion:** Docker, Nginx, observabilidad, rollout, rollback y convivencia
   con el CRM compilado.

Cada hallazgo con severidad, evidencia, archivo/linea, reproduccion y prueba de
regresion. Corregir criticos y altos antes de produccion write-enabled. Reejecutar
una revision final.

---

## Habilitacion gradual (Fase F), solo despues de lo anterior

1. Preview GET-only hasta cerrar hallazgos altos.
2. Migracion con ventana, backup y observacion.
3. Worker primero contra un endpoint interno controlado.
4. Una sola clave y empresa piloto, con scopes minimos.
5. Escrituras en Nginx y `READ_ONLY_MODE=false` solo para el piloto.
6. Observar errores, latencia, lag de outbox, dead letters y duplicados.
7. Expandir por empresas y scopes, con cada paso reversible sin perder eventos.

**`send-media` queda fuera de todas estas etapas hasta cerrar el bloque 1.**
