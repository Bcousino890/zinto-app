# Auditoría de contrato (`openapi/openapi.yaml` frente a `src/routes/*.ts`)

Fecha: 13 de agosto de 2026.
Alcance: los 8 archivos de rutas actuales (`contact-mutations.ts`, `core.ts`,
`me.ts`, `media.ts`, `message-send.ts`, `pipelines.ts`, `pipeline-mutations.ts`,
`webhooks.ts`) comparados línea por línea contra `openapi/openapi.yaml`. Esta
es la auditoría número 2 de las 4 previstas antes de habilitar escrituras en
producción: contrato OpenAPI frente a rutas, cuerpos, status y scopes.

---

## Metodología

1. Se leyeron completos los 8 archivos de `src/routes/*.ts`, además de los
   módulos que sus propios `preHandler`/handlers invocan directamente y que
   determinan status codes reales: `src/auth/api-key.ts`, `src/auth/scopes.ts`,
   `src/http/errors.ts`, `src/http/idempotency.ts`, `src/http/pagination.ts`,
   `src/delivery/media-url.ts`, `src/media/fetch.ts`, `src/media/proxy.ts` y
   `src/webhooks/repository.ts`. `src/app.ts` se leyó solo para entender cómo
   se conectan los `preHandler` de cada ruta (paso obligatorio para saber qué
   scope exige cada operación), no como objeto de esta auditoría.
2. Para cada `app.get/post/patch/put/delete` de los 8 archivos se verificó:
   - Que el path y método existen en el YAML con el mismo nombre de parámetro
     de ruta. Esto además lo garantiza automáticamente
     `test/openapi.test.ts` ("documents every route the service actually
     registers"), que ya pasaba antes de este trabajo y se mantiene pasando.
   - Que el scope exigido por `assertScopes(...)` coincide con lo documentado.
   - Que el schema Zod `.strict()` del body coincide campo a campo, en
     `required` y en `additionalProperties` con el `requestBody` del YAML.
   - Que cada rama real de error (`throw new ApiError(status, code, ...)`,
     incluida la que recorre el `preHandler` de autenticación/scopes antes del
     handler) tiene su status documentado en `responses`.
   - Que los parámetros de query documentados (`cursor`, `limit`,
     `updated_since`, filtros propios de cada recurso) coinciden con los que
     cada ruta realmente acepta vía `parseListQuery`/`parsePageQuery`.
3. Se corrigieron en `openapi/openapi.yaml` únicamente discrepancias
   verificadas contra el código real (nunca al revés). No se tocó ningún
   archivo de `src/`.

### Sobre scopes y el mecanismo de seguridad del YAML

El proyecto **no documenta el scope requerido por operación en ningún
mecanismo existente**: no hay `security` con scopes de OAuth2/apiKey por
operación (el único `securitySchemes` es `bearerAuth` de tipo `http`/`bearer`,
sin campo `scopes`), y tampoco hay prosa por operación que declare el scope.
Por tanto no hay una "afirmación" en el YAML que pueda estar equivocada
respecto al scope real de cada ruta — no hay nada que corregir en ese eje
concreto. Se verificó igualmente, ruta por ruta, qué scope exige cada
`protect()`/`protectedHandler()` (tabla más abajo) para dejar constancia, y se
señala como hallazgo de diseño (no de bug) al final de este documento: añadir
un mecanismo de scopes por operación sería una funcionalidad nueva del
contrato, fuera del alcance de "corregir discrepancias reales" que definió
esta auditoría (no se debe inventar un mecanismo que no existe).

---

## Tabla de rutas auditadas

Todas las 26 operaciones registradas (más `GET /health` y `GET /ready`, sin
auth) fueron auditadas. Veredicto: **conforme** (ya coincidía), **corregido**
(se editó el YAML) o **hallazgo pendiente** (no se tocó ni código ni YAML;
decisión del propietario).

| Operación | Scope exigido | Veredicto |
|---|---|---|
| `GET /health` | ninguno (`security: []`) | conforme |
| `GET /ready` | ninguno (`security: []`) | conforme |
| `GET /api/v1/me` | ninguno (solo auth) | corregido (403 IP) |
| `GET /api/v1/channels` | `channels:read` | corregido (401) |
| `GET /api/v1/contacts` | `contacts:read` | corregido (401/403) |
| `POST /api/v1/contacts` | `contacts:write` | corregido (401/403) |
| `PATCH /api/v1/contacts/{id}` | `contacts:write` | corregido (400/401/403) |
| `DELETE /api/v1/contacts/{id}` | `contacts:write` | corregido (400/401/403) |
| `POST /api/v1/contacts/{id}/notes` | `notes:write` | corregido (400/401/403) |
| `PATCH /api/v1/notes/{id}` | `notes:write` | corregido (400/401/403) |
| `DELETE /api/v1/notes/{id}` | `notes:write` | corregido (400/401/403) |
| `PUT /api/v1/contacts/{id}/tags/{tag}` | `tags:write` | corregido (400/401/403); ver hallazgo pendiente sobre `tag` |
| `DELETE /api/v1/contacts/{id}/tags/{tag}` | `tags:write` | corregido (400/401/403); ídem |
| `GET /api/v1/pipelines` | `pipelines:read` | corregido (401/403) |
| `GET /api/v1/pipelines/{id}/stages` | `pipelines:read` | corregido (401/403) |
| `GET /api/v1/deals` | `deals:read` | corregido (401/403) |
| `GET /api/v1/deals/{id}` | `deals:read` | corregido (401/403) |
| `PATCH /api/v1/deals/{id}/stage` | `deals:write` | corregido (401; ya tenía 403) |
| `GET /api/v1/tasks` | `tasks:read` | corregido (401/403) |
| `GET /api/v1/conversations` | `conversations:read` | corregido (400/401/403) |
| `GET /api/v1/conversations/{id}/messages` | `conversations:read`, `messages:read` | corregido (400/401/403) |
| `POST /api/v1/messages/send` | `messages:send` | corregido (400/401/403/422) |
| `POST /api/v1/messages/send-media` | `messages:send` | corregido (401/403/404/409) |
| `POST /api/v1/messages/send-template` | `messages:send` | corregido (400/401/403/404/409) |
| `POST /api/v1/messages/send-interactive` | `messages:send` | corregido (400/401/403/404/409) |
| `GET /api/v1/webhooks` | `webhooks:manage` | corregido (401/403) |
| `POST /api/v1/webhooks` | `webhooks:manage` | corregido (401/403) |
| `DELETE /api/v1/webhooks/{id}` | `webhooks:manage` | corregido (400/401/403) |
| `GET /internal/media/:id` (`media.ts`) | sin auth (deliberado) | conforme — es la única ruta que el propio `test/openapi.test.ts` documenta como no publicada (`unpublished`), y así se mantiene: solo se alcanza por red interna, sirve por 256 bits de capacidad en la URL. |

Body de cada schema Zod `.strict()` (campos, `required`,
`additionalProperties`): conforme en las 9 operaciones con `requestBody`
(`ContactCreate`, `ContactUpdate`, `NoteInput`, `DealStageInput`,
`TextMessageInput`, `MediaMessageInput`, `TemplateMessageInput`,
`InteractiveMessageInput`, `WebhookCreate`), salvo las tres correcciones de
límites detalladas abajo y la corrección de `event_types`.

Parámetros de query (`cursor`, `limit`, `updated_since`, `pipeline_id`,
`contact_id`): conforme en las 8 operaciones que aceptan filtros — no se
encontró ningún filtro real aceptado por `parseListQuery`/`parsePageQuery` que
no estuviera ya documentado, ni ningún parámetro documentado que el código no
lea.

---

## Discrepancias reales encontradas y corregidas

### 1. Status 401/403 ausentes en prácticamente toda la API (el hallazgo principal)

Cada uno de los 8 archivos de rutas define su propio `protect()` /
`protectedHandler()`, que siempre llama primero a
`createApiKeyAuthenticator(...)` (`src/auth/api-key.ts`) y, salvo en
`me.ts`, después a `assertScopes(...)` (`src/auth/scopes.ts`). Ambas
funciones son código de las propias rutas (no un hook global de `app.ts`):
cada ruta las invoca explícitamente en su registro.

- `createApiKeyAuthenticator` lanza `ApiError(401, ...)` en cuatro ramas
  (`missing_api_key`, `invalid_api_key`, `api_key_inactive`,
  `api_key_expired` — `src/auth/api-key.ts:48-65`) y `ApiError(403,
  "ip_not_allowed", ...)` cuando la API key tiene `allowed_ips` configurado
  (`src/auth/api-key.ts:67-69`). Esta última rama aplica a **toda** ruta
  protegida, incluida `/api/v1/me`, que no llama a `assertScopes` pero sí pasa
  por esta autenticación.
- `assertScopes` lanza `ApiError(403, "insufficient_scope", ...)`
  (`src/auth/scopes.ts:8`) en toda ruta que la invoca — todas menos
  `/api/v1/me`.

Antes de esta auditoría, el YAML solo documentaba `401` en `/api/v1/me` y
`403` en `/api/v1/channels` y `/api/v1/deals/{id}/stage` — 25 de las 27
operaciones protegidas no documentaban ninguno de los dos, pese a que ambos
son alcanzables en cualquier request real con una API key inválida, expirada,
sin el scope correcto, o restringida por IP. **Corregido**: se añadió
`"401": { $ref: "#/components/responses/Unauthorized" }` a las 26 operaciones
protegidas que lo aceptan, y `"403": { $ref: "#/components/responses/Forbidden" }`
a las 27 (incluida `/api/v1/me`, por `ip_not_allowed`). Los dos `$ref` ya
existían en `components.responses` con descripciones genéricas que cubren
ambas razones (`Forbidden`: "Required scope or source IP is not allowed"), así
que no hizo falta crear componentes nuevos.

### 2. `message-send.ts`: cada una de las 4 rutas tenía un conjunto de status distinto al real

Se verificó cada rama de error de `src/routes/message-send.ts` por separado,
tal como pedía el encargo, sin asumir que las 4 rutas comparten status:

- **`POST /api/v1/messages/send`**: el YAML documentaba `201, 404, 409, 502,
  504` pero el código también puede devolver `400` (`parse(textSchema, ...)`
  línea 202, y `withIdempotency` cuando falta o es inválida la cabecera
  `Idempotency-Key`) y `422` (`ensureCapability(selected, "text")`, línea
  204, `channel_capability_unsupported`). **Corregido**: se añadieron `400` y
  `422`.
- **`POST /api/v1/messages/send-media`**: documentaba `201, 400, 422, 502,
  503, 504` pero le faltaban `404` (`channel_not_found` de `selectChannel`,
  línea 216) y `409` (`channel_inactive`, mismo `selectChannel`).
  **Corregido**: se añadieron `404` y `409`.
- **`POST /api/v1/messages/send-template`**: documentaba solo `201, 422, 502,
  504`. Le faltaban `400` (parse del body), `404` y `409` (mismo
  `selectChannel` que las otras tres rutas, línea 241). **Corregido**: se
  añadieron los tres.
- **`POST /api/v1/messages/send-interactive`**: mismo patrón que
  `send-template` — documentaba `201, 422, 502, 504`; le faltaban `400`, `404`
  y `409`. **Corregido**.

Se verificó además contra `test/message-send.test.ts`, que ya ejercita
`400, 201, 404, 409, 422, 503, 504, 502` en sus asserts — todos esos status
están ahora reflejados en el YAML para la operación que corresponde a cada
uno.

### 3. `400` ausente en operaciones con validación de ID o de body por `parse()`/`id()`

`contact-mutations.ts` valida el `id` de ruta con el helper local `id()`
(línea 34-37, `ApiError(400, "validation_error", ...)`) y el body con
`parse()` (línea 28-32) en varias rutas donde el YAML solo documentaba el
`200`/`201`/`204` y el `404`. Mismo patrón en `webhooks.ts` (`DELETE
/api/v1/webhooks/{id}`, línea 85-87) y en `core.ts` (`GET
/api/v1/conversations/{id}/messages`, línea 66-68, y `GET
/api/v1/conversations`/`GET /api/v1/contacts` vía `parsePageQuery`, que
también puede lanzar `400` — `src/http/pagination.ts:34-36`). **Corregido**:
se añadió `400` a `PATCH/DELETE /api/v1/contacts/{id}`, `POST
/api/v1/contacts/{id}/notes`, `PATCH/DELETE /api/v1/notes/{id}`,
`PUT/DELETE /api/v1/contacts/{id}/tags/{tag}`, `DELETE /api/v1/webhooks/{id}`,
`GET /api/v1/conversations` (no tenía **ningún** status de error documentado
antes de esta corrección) y `GET /api/v1/conversations/{id}/messages`.

### 4. `WebhookCreate.event_types`: `uniqueItems: true` no es cierto

El YAML declaraba `uniqueItems: true` para `event_types`, pero el schema Zod
real (`src/routes/webhooks.ts:25-28`) es
`z.array(z.enum(webhookEventTypes)).min(1).max(webhookEventTypes.length)` —
sin ningún `.refine()` de unicidad. Se confirmó además que
`PostgresWebhookRepository.create` (`src/webhooks/repository.ts:48-64`)
inserta `input.eventTypes` tal cual, sin deduplicar. Es decir: hoy la API
acepta `event_types: ["contact.created", "contact.created"]` sin error,
justo lo contrario de lo que el YAML afirmaba. **Corregido**: se eliminó
`uniqueItems: true` (documentar una validación que no existe es tan
incorrecto como omitir una que sí existe) y se añadió `maxItems: 20`, que sí
es un límite real (`webhookEventTypes.length === 20`) y que el YAML no
declaraba en absoluto.

### 5. Campo `to` sin límites documentados en 3 de los 4 schemas de envío

Las cuatro rutas de `message-send.ts` comparten literalmente el mismo
`common.to: z.string().trim().min(1).max(320)` (línea 20). El YAML solo
documentaba `minLength: 1, maxLength: 320` en `TextMessageInput.to`; en
`MediaMessageInput`, `TemplateMessageInput` e `InteractiveMessageInput` el
mismo campo aparecía como `{ type: string }` sin límites — inconsistencia
clara dentro del mismo archivo para el mismo valor de código, no un límite
nunca documentado. **Corregido**: se añadió `minLength: 1, maxLength: 320` a
`to` en los tres schemas restantes.

### 6. `media_url` sin `maxLength` en `MediaMessageInput`

`mediaSchema.media_url` es `z.string().url().max(2048)`
(`message-send.ts:26`); el YAML documentaba `format: uri` pero no el límite
de longitud, mientras que en el mismo schema `caption` y `filename` sí tenían
su `maxLength` documentado. **Corregido**: se añadió `maxLength: 2048`.

---

## Hallazgos que NO se corrigieron (decisión del propietario)

### A. `PUT`/`DELETE /api/v1/contacts/{id}/tags/{tag}`: un `tag` inválido produce `500`, no `400` — parece un bug real del código

En `src/routes/contact-mutations.ts` líneas 143 y 158, el parámetro `tag` se
valida así:

```ts
const tag = z.string().trim().min(1).max(100).parse(request.params.tag);
```

A diferencia de **todo el resto del archivo**, que usa el patrón
`schema.safeParse(...)` + `throw new ApiError(400, "validation_error", ...)`
(la función `parse()` definida en las líneas 28-32 del mismo archivo, usada
para el body de cada ruta, y el helper `id()` para los IDs de ruta), aquí se
usa `.parse()` directamente, que lanza un `ZodError` sin envolver. Ese
`ZodError` no es `instanceof ApiError`, así que cae al manejador genérico de
`src/http/errors.ts` (líneas 51-58) y se responde `500 internal_error` — un
error indistinguible de un bug interno del servicio, en vez del `400
validation_error` que el resto de la API devuelve consistentemente ante
input inválido.

Es difícil de disparar en la práctica (`min(1)` casi nunca falla porque
Fastify no enrutaría un segmento de path vacío a `:tag`), pero `max(100)` sí
es alcanzable: cualquier partner que use un nombre de tag de más de 100
caracteres en la URL de `PUT`/`DELETE /api/v1/contacts/{id}/tags/{tag}\`
recibe hoy un `500` en vez de un `400`. No se corrigió el código (fuera de
alcance: esta auditoría es de contrato, no de lógica de negocio) ni se
documentó `500` en el YAML (ningún operación de esta API documenta `500`,
consistente con la práctica ya existente en el resto del archivo). El
propietario debe decidir si:
- cambia `.parse()` por `.safeParse()` + `ApiError(400, ...)` para alinear
  esta rama con el resto del archivo (arreglo de una línea, de riesgo bajo,
  y consistente con el patrón que el propio archivo ya usa en todas las
  demás validaciones), o
- lo deja así si considera que la probabilidad de que esto ocurra en
  producción es despreciable.

### B. El interruptor de solo-lectura (`503 read_only_mode`) y el límite de tasa (`429 rate_limit_exceeded`) no están documentados — deliberadamente no tocados

`src/app.ts` registra dos hooks globales de `onRequest`, fuera de los 8
archivos de rutas auditados:

- Un gate de solo-lectura (líneas 63-69) que hoy, con la configuración por
  defecto (`readOnly = true`), devuelve `503 { code: "read_only_mode" }` para
  **toda** petición no `GET/HEAD/OPTIONS` bajo `/api/v1/*` — es decir, hoy
  mismo, cualquier partner que intente escribir recibe este `503` en vez de
  ejecutar la operación. Es precisamente el interruptor que Bloque 6 existe
  para desactivar.
- Un límite de tasa por IP (`createIpRateLimitHook`, aplicado a todo
  `/api/v1/*` antes incluso de la autenticación) más límites por API key y
  por compañía dentro de `createApiKeyAuthenticator` — todos devuelven `429
  rate_limit_exceeded` (`src/http/rate-limit.ts:80-84`).

Ambos son código real que hoy puede responder a cualquier operación de
escritura (el primero) o a cualquier operación (el segundo), y en sentido
estricto son ramas de `throw new ApiError(status, code, ...)` reales. No los
añadí al YAML porque:

1. Viven exclusivamente en `src/app.ts`, fuera de los 8 archivos de rutas que
   el encargo delimitó explícitamente como "TODO el código de rutas actual" —
   a diferencia de `assertScopes`/`createApiKeyAuthenticator`, que cada ruta
   invoca explícitamente en su propio `preHandler`, estos dos hooks se
   registran una sola vez, de forma uniforme, sin que ningún archivo de rutas
   participe en la decisión.
2. El gate de solo-lectura es, por diseño, temporal — es exactamente el
   mecanismo que Bloque 6 busca desactivar antes de habilitar escrituras en
   producción. Documentarlo permanentemente en el contrato de cara al partner
   mezclaría un interruptor operativo transitorio con la forma estable de la
   API.
3. Añadir `503`/`429` de forma sistemática a las ~20 operaciones que
   corresponda es una decisión de diseño del contrato (¿se documenta como
   parte estable de la API o se trata como me canismo operativo interno?),
   no una corrección mecánica de fidelidad — encaja con el criterio del
   encargo de "si es ambiguo o requiere una decisión de diseño, no lo
   arregles a ciegas, decláralo".

El propietario debe decidir si el rate-limit y (mientras exista) el gate de
solo-lectura deben documentarse en el contrato público, y si es así, con qué
alcance.

### C. Límites de `ContactFields` no documentados en ningún lado (no es una inconsistencia, es documentación nunca escrita)

A diferencia de los casos corregidos en el punto 5 y 6 (donde el mismo campo
ya tenía el límite documentado en un schema hermano y faltaba en otro),
`ContactFields` (`src/routes/contact-mutations.ts:12-22`) tiene límites reales
en `email` (`max(320)`), `phone` (`min(3).max(50)`), `avatar_url`
(`max(2048)`), `company`/`source` (`max(500)`, vía `nullableString`), `notes`
(`max(20_000)`) y `tags` (array `max(100)`, items `min(1).max(100)`) que
**nunca** se han documentado en el YAML — no hay ninguna instancia de estos
campos con límites ya escritos que sugiera un olvido puntual, es documentación
que sencillamente nunca se añadió. El encargo de esta auditoría, en su punto
3, pide verificar "los mismos límites donde el YAML los declare", lo que leí
como: confirmar que los límites ya declarados son correctos, no perseguir
exhaustivamente cada límite nunca capturado en ningún schema (una tarea
distinta, de mucho mayor superficie, más cercana a generación de schema que a
auditoría de discrepancias). Se deja constancia aquí en vez de editar el YAML
sin más contexto, para que el propietario decida si vale la pena esa pasada
adicional.

---

## Verificación final

```
$ npm test        → 23 archivos, 313/313 pruebas — PASS (incluye las 4 de test/openapi.test.ts)
$ npm run typecheck → tsc -p tsconfig.json --noEmit — sin errores
$ npm run build     → tsc -p tsconfig.json — sin errores
```

Ningún test cambió de comportamiento: `test/openapi.test.ts` sigue validando
que el documento es OpenAPI 3.1 válido y que la lista de operaciones/rutas
registradas coincide exactamente con las documentadas: esa prueba no cubre
los status/scopes/límites que sí se corrigieron aquí, que es precisamente el
hueco que esta auditoría manual venía a cerrar.
