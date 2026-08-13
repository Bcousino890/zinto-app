# Auditoría del adaptador propio de entrega (`src/delivery/client.ts`)

Fecha: 13 de agosto de 2026.
Alcance: `src/delivery/client.ts` y su único llamador, `src/routes/message-send.ts` —
el código que SÍ es nuestro, a diferencia del motor legacy compilado auditado en
`docs/api/LEGACY-ENGINE-AUDIT-2026-08-13.md`.

---

## Parte 1 — El bloqueante de `sender_id=1` reafirmado con precisión

`docs/api/LEGACY-ENGINE-AUDIT-2026-08-13.md`, sección "PREGUNTA 1 — Autoría de
los envíos" (líneas 49-240), estableció con confianza **ALTA**, verificado
byte a byte contra el bundle `dist/index.js` real de producción:

- Las cuatro rutas de envío del motor legacy (`/messages/send`, `send-media`,
  `send-template`, `send-interactive`), en todos los canales salvo dos
  excepciones puntuales, escriben `sender_id = 1` como **literal incrustado
  en el código compilado** (líneas 104-134 del audit, offsets
  ~3706100/~3709900/~3701900/~3703000 del bundle). Las excepciones:
  `messenger` usa `channel_connections.user_id` (tampoco la API key), y
  `send-media` sobre `whatsapp_official` escribe `sender_id=NULL,
  is_from_bot=true` en vez de atribuir a nadie (líneas 196, 201-216).
- El middleware de autenticación (`lX`/`authenticateApiKey`) carga
  `api_keys.user_id` en memoria pero **nunca lo propaga** a la request —
  confirmado por conteo sobre el bundle completo: `grep -c "apiKey.userId"` y
  `grep -c "req.userId"` devuelven **0** sobre 4.4 MB de código (líneas 73-88
  del audit).
- Las rutas `/api/v1/messages/*` pasan solo `companyId` al servicio
  (`zp.sendMessage(r.companyId, e)`, línea 95); su firma no admite un
  identificador de usuario en ninguna de las cuatro entradas.

**Conclusión, sin matices:** este bloqueante **no es corregible desde
`src/delivery/client.ts` ni desde ningún otro archivo de esta API**. El
problema no vive en cómo llamamos al motor legacy — vive dentro del propio
motor, en un bundle minificado sin fuente TypeScript original, sin tests de
caracterización y sin build reproducible. Aunque nuestro adaptador enviara un
identificador de usuario en la petición HTTP, las cuatro rutas del motor no lo
leerían: el literal `1` (o la variable local `o=1` en plantillas/interactivos)
está incrustado varios niveles por debajo del punto donde entra la petición
HTTP, en la función de despacho por canal (`XL.sendThroughChannel` /
`XL.sendMediaThroughChannel`), no en la capa de enrutamiento que sí controla
esta API.

El arreglo real —propagar `userId` en el middleware y sustituir ~14 literales
en dos métodos— es pequeño y ya está identificado con precisión quirúrgica en
la auditoría legacy. Pero modificar el bundle compilado que sirve tráfico de
producción real, sin fuente, sin tests de caracterización y sin build
reproducible, es una decisión que le corresponde al propietario, no a un
cambio que esta rama pueda incluir por su cuenta. **Esto sigue bloqueando
formalmente habilitar `messages:send` para un partner real**: cada mensaje
enviado vía API aparecerá en el CRM como enviado por el usuario 1 (o como bot
sin autor, en `whatsapp_official` + `send-media`), nunca por la integración
que realmente lo envió.

---

## Parte 2 — Auditoría de `client.ts` y qué SÍ es corregible desde nuestro lado

### Qué hacía bien ya antes de este bloque

- Timeout acotado y configurable vía `AbortSignal.timeout(this.timeoutMs)`,
  con `LEGACY_DELIVERY_TIMEOUT_MS` validado en `src/config.ts` con límites
  razonables (`min(1000).max(120_000).default(30_000)` — confirmado con un
  test nuevo que fija ese valor por defecto y rechaza límites fuera de rango).
- `DeliveryAdapterError` protege el payload crudo del motor legacy (que puede
  llevar teléfonos y contenido de mensajes de clientes) detrás de un getter en
  vez de un campo enumerable plano, precisamente para que el serializador por
  defecto de pino (`for...in` sobre el error) no lo capture por accidente en
  los logs. `performDelivery` solo loguea `error.statusCode`, nunca
  `error.response`.
- Validación estricta de la forma de la respuesta del motor legacy antes de
  aceptarla como éxito (`payload.success !== true || payload.data ===
  undefined` → error; campos requeridos ausentes → 502), en vez de confiar
  ciegamente en un `success: true` sin cuerpo utilizable.

### Gaps encontrados y qué se implementó

**(a) Nuestro propio rastro de auditoría con el autor real — implementado.**
Antes de este bloque, un envío exitoso vía `/api/v1/messages/*` no escribía
nada en `integration_api_audit_records` ni en `integration_api_outbox`:
nuestro propio sistema de auditoría estaba tan ciego como la UI del CRM sobre
quién había enviado cada mensaje. Se añadió `src/resources/delivery-audit.ts`
(`DeliveryAuditRepository`, `PostgresDeliveryAuditRepository`) y se conectó
como dependencia opcional en `performDelivery`
(`src/routes/message-send.ts`): tras un `delivery.deliver()` exitoso, se
inserta un registro en `integration_api_audit_records` con
`actor_user_id = request.apiPrincipal.userId` (el usuario real dueño de la API
key), `action = "message.sent"`, sin transacción (es un `INSERT` posterior a
una llamada HTTP externa ya resuelta, no hay una escritura propia que envolver)
y **best-effort**: si el `INSERT` falla, se registra un `warn` y la respuesta
201 al partner no se ve afectada — el envío real ya ocurrió, una falla de
bookkeeping no debe convertirlo en un error para el partner. Deliberadamente
NO escribe en `integration_api_outbox`: un evento de webhook `message.sent`
sería redundante para el propio partner que acaba de enviarlo, así que se
limitó el alcance a lo que sí aporta valor — que nuestra propia auditoría
interna no quede ciega, aunque la UI del CRM lo siga estando.

Esto **no corrige `messages.sender_id` en el CRM** (ver Parte 1) — es un
mecanismo complementario y estrictamente más limitado: solo nuestro propio
sistema de auditoría queda al tanto del autor real.

**(b) Reintento ante fallos transitorios — implementado, acotado a un caso
seguro.** Se evaluó la hipótesis de que reintentar dentro del adaptador es
peligroso porque, si la petición ya llegó al motor legacy pero se perdió la
respuesta, un reintento automático podría duplicar un envío real a WhatsApp/
SMS/etc. Se confirmó: solo hay un subconjunto de fallos donde puede probarse
que **ni un solo byte** de la petición salió del proceso — un `fetch` que
falla antes de que exista una respuesta, con causa `ECONNREFUSED` o
`ENOTFOUND` (verificado directamente contra este runtime de Node/undici,
conectando a un puerto cerrado y a un host no resoluble, no asumido por
documentación). Node reporta todos los fallos a nivel de `fetch` de forma
uniforme como `TypeError: fetch failed` con la causa real en `error.cause`;
`isPreConnectFailure()` distingue ese subconjunto y solo entonces reintenta
**exactamente una vez**. Cualquier otro fallo (timeout, conexión reiniciada
después de establecida, causa no reconocida) se propaga sin tocar. Cubierto
con pruebas mockeadas (`test/delivery-client.test.ts`) y una prueba adicional
contra la pila de red real (bind a un puerto libre, cerrarlo, confirmar que un
intento de conexión real falla exactamente de la forma que las pruebas
mockeadas asumen), para no depender solo de una forma de error asumida.

**(c) Granularidad de errores — implementado, cambio mínimo y seguro.**
Antes, cualquier rechazo del motor legacy colapsaba al genérico 502
`delivery_failed`. Se distingue ahora `delivery_rejected` (4xx del propio
motor legacy: la petición en sí fue rechazada, reintentarla sin cambios no
ayudará) de `delivery_failed` (5xx o respuesta inesperada: el motor está caído
o se comportó de forma anómala, reintentar más tarde con la misma clave de
idempotencia sí tiene sentido). El HTTP status sigue siendo 502 en ambos
casos — solo cambia `error.code` y el mensaje — así que nada que decida
reintentar basándose en el status HTTP observa un cambio de comportamiento.
Documentado en `docs/ERRORS.md` y en `openapi/openapi.yaml`
(`components.responses.DeliveryFailed`).

Adicionalmente, un fallo de red no reconocido como reintentable (por ejemplo
`ECONNRESET` tras un socket ya establecido) que antes cayera fuera de todas
las ramas reconocidas en `performDelivery` habría surgido como un genérico 500
`internal_error`, indistinguible de un bug de este servicio. Ahora se trata
como el mismo 504 `delivery_timeout` que ya existía para timeouts explícitos:
es la elección conservadora — el resultado real puede a veces ser más cierto
que "desconocido" (dos rechazos de conexión seguidos genuinamente nunca
llegaron al motor), pero nunca es menos seguro que lo que "desconocido" ya le
indica a un partner que haga (verificar antes de reintentar).

**(d) Timeout — verificado, sin cambios necesarios.** El valor por defecto
(30 s) y los límites (1 s–120 s) en `src/config.ts` ya eran razonables; se
añadió un test que los fija explícitamente. El camino 504 `delivery_timeout`
ya existente para `AbortError`/`TimeoutError` ya estaba cubierto por
`test/message-send.test.ts`.

### Candidatos evaluados y descartados (no implementados)

Ninguno adicional: los cuatro candidatos previstos para esta auditoría — (a),
(b), (c) y (d) — se evaluaron y los tres primeros se implementaron dentro de
límites de riesgo estrictos; el cuarto se verificó sin requerir cambios. No se
encontraron otros gaps de bajo riesgo dentro del alcance de `client.ts` y sus
llamadores directos que justificaran un cambio adicional.

---

## Resumen para el propietario

- El bloqueante de `sender_id=1` sigue exactamente donde estaba: en el bundle
  compilado, fuera del alcance de esta API. No se puede cerrar sin decidir
  intervenir ese bundle.
- Lo que sí se pudo mejorar desde nuestro lado ya está implementado y
  probado: nuestra propia auditoría deja de estar ciega sobre el autor real
  de un envío (aunque el CRM lo siga estando), un fallo de red que
  demostrablemente no llegó a salir se reintenta una vez en vez de fallar de
  inmediato, y un partner puede distinguir "tu petición estaba mal" de "el
  motor está caído" sin adivinar.
- Ningún cambio de esta parte modifica el comportamiento observable de un
  envío que hoy tiene éxito o falla de forma ya reconocida; los cambios son
  aditivos y todos tienen prueba de regresión.
