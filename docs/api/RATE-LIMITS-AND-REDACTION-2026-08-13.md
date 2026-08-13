# Limites de peticion, limites de cuerpo y auditoria de redaction

Fecha: 13 de agosto de 2026
Rama: `agent/rate-limits`
Commit base al empezar: `02efcfb` (sin commits propios en el worktree)
Cierra las fases B.4, B.5 y B.6 del runbook (`docs/api/NEXT-PHASE-PLAN-2026-08-13.md`,
bloque 2). No se tocaron Docker, la base de datos, ni `READ_ONLY_MODE`
(sigue en `true` por defecto). No se aplico ninguna migracion.

Metodo: TDD estricto en los tres bloques — prueba roja, implementacion
minima, suite completa — con commits separados por fase. Estado final:

```
npx vitest run   -> 16 archivos, 179 pruebas, todas en verde
npm run typecheck -> limpio
npm run build      -> limpio
```

(La suite baseline al hacer `npm ci` en este worktree mostro 149 pruebas, no
231; es la baseline real de este punto de partida, sin fusionar trabajo de
otras ramas. Las 179 finales son 149 + 30 nuevas de este bloque.)

---

## B.4 — Limites de peticion (rate limiting)

### Diseno

Tres cubos de conteo por ventana fija, implementados en `src/http/rate-limit.ts`:

- **Por API key** y **por empresa**, comprobados dentro de
  `createApiKeyAuthenticator` (`src/auth/api-key.ts`) justo despues de
  confirmar que la clave es valida. Es el unico punto de autenticacion por el
  que pasan todas las rutas protegidas, asi que no hace falta duplicar logica
  por ruta — solo pasar el `RateLimiter` como parametro opcional, que se
  propaga desde `buildApp` (`src/app.ts`) hasta cada `registerXRoutes`.
- **Por IP de origen**, como hook global `onRequest` (`createIpRateLimitHook`)
  registrado en `src/app.ts`, con alcance a `/api/v1/*` y ejecutado **antes**
  de la autenticacion. Esto es deliberado: tambien acota el abuso no
  autenticado (claves invalidas, fuerza bruta contra el formato `pcp_...`)
  desde una misma direccion, que de otro modo no consumiria ningun cubo hasta
  pasar por la autenticacion.

`/health` y `/ready` quedan fuera de `/api/v1/`, así que ningún cubo los
afecta — probado explícitamente en `test/rate-limit.test.ts` agotando el
límite de IP y confirmando 200 repetido en ambas rutas.

### Respuesta ante limite excedido

`429` con el sobre canonico y cabecera `Retry-After` en segundos:

```json
{
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Too many requests; retry later",
    "request_id": "req_..."
  }
}
```

Para soportarlo de forma general (no solo para rate limit), `ApiError` ahora
acepta un cuarto parametro opcional `headers` (por defecto `{}`,
retrocompatible), y `registerErrorHandlers` los aplica antes de enviar la
respuesta. `rateLimitError()` en `rate-limit.ts` construye el `ApiError` con
`{ "Retry-After": "<segundos>" }`.

### Valores por defecto y justificacion

Variables de entorno nuevas en `src/config.ts` (mismo patron Zod que el resto
del archivo):

| Variable | Por defecto | Justificacion |
| --- | --- | --- |
| `RATE_LIMIT_WINDOW_MS` | `60000` (1 min) | Ventana corta: un cliente que se pasa se recupera en menos de un minuto sin intervencion de un operador. |
| `RATE_LIMIT_PER_KEY_MAX` | `300` (5 req/s) | Cubo primario: generoso para una integracion legitima (polling de conversaciones, gestion de webhooks), pero acota el dano de una clave comprometida o con un bug de reintento. |
| `RATE_LIMIT_PER_IP_MAX` | `600` (2x la clave) | Existe sobre todo para trafico **no autenticado** (claves invalidas, fuerza bruta) y para que una sola IP no eluda el limite por clave rotando varias claves. Tiene que ser mayor que el limite por clave: una integracion legitima de una sola IP con una sola clave no debe chocar antes con el cubo mas generico que con el mas especifico. |
| `RATE_LIMIT_PER_COMPANY_MAX` | `1200` (2x la IP, 4x la clave) | Red mas amplia: una empresa puede tener varias claves activas (produccion, staging, distintos equipos). Escalado para permitir del orden de 4 claves a maximo rendimiento simultaneamente antes de que la empresa entera se vea afectada. |

Orden `clave < IP < empresa` es intencional: el cubo mas especifico y
predecible (clave) es el primero en actuar para un cliente bien portado; el
cubo de IP solo muerde patrones de abuso (rotacion de claves, trafico sin
autenticar); el cubo de empresa es la red de seguridad mas amplia.

### Limitacion declarada: en memoria por proceso

`RateLimiter` guarda los contadores en un `Map` dentro del proceso Node. Es
suficiente para esta fase (una sola replica en preview), pero:

- **Con N replicas detras del balanceador, el limite efectivo se multiplica
  por N.** Una clave limitada a 300/min en una replica puede alcanzar hasta
  300×N/min repartida entre replicas, porque cada proceso cuenta de forma
  independiente y no hay coordinacion entre ellos.
- **Que haria falta para distribuirlo:** sustituir el `Map` interno por un
  almacen compartido (Redis con `INCR` + `EXPIRE` por cubo, o un script Lua
  de ventana deslizante para evitar el efecto "doble ventana" del contador
  fijo) detras de la misma interfaz publica
  (`checkApiKey` / `checkCompany` / `checkIp`, cada una devolviendo
  `null | segundosDeEspera`). El resto del sistema (el hook de IP, el
  autenticador) no necesitaria cambios: solo la implementacion de
  `RateLimiter`.
- Mientras el despliegue sea de una sola replica (el caso actual del
  preview), esta limitacion no aplica.

### Pruebas (`test/rate-limit.test.ts`, `test/config.test.ts`)

18 pruebas nuevas en total: 5 unitarias sobre `RateLimiter` (permite hasta el
limite, `Retry-After` correcto en segundos, la ventana se reinicia, cubos
independientes por clave/empresa/IP, defaults razonables) + 8 de integracion
HTTP via `buildApp`/`app.inject` (limite por clave con 429 y `Retry-After`,
una clave distinta no rescata a otra agotada, limite por empresa compartido
entre dos claves, aislamiento entre empresas, limite por IP que tambien cubre
peticiones sin autenticar, aislamiento entre IPs, `/health`/`/ready` nunca
limitados, reinicio de ventana con reloj inyectado) + 2 en `config.test.ts`
(defaults documentados, override por variable de entorno).

---

## B.5 — Limites de cuerpo

### Diseno

`src/http/body-limits.ts` define tres constantes; no son variables de
entorno (a diferencia del rate limit, son limites estructurales atados a lo
que cada esquema Zod ya valida, no algo que un operador deba ajustar por
despliegue):

| Limite | Valor | Donde se aplica | Justificacion |
| --- | --- | --- | --- |
| `globalBodyLimitBytes` | 128 KiB | `bodyLimit` global en el constructor de Fastify (`src/app.ts`) | Esta API es solo JSON: la media viaja por referencia (URL), nunca como subida. 128 KiB es 8x mas conservador que el default de Fastify (1 MiB) y sigue cubriendo con margen el peor caso legitimo actual: una nota de contacto de 20.000 caracteres (hasta ~80 KB en UTF-8 en el peor caso) mas etiquetas y `custom_fields`. |
| `messageBodyLimitBytes` | 32 KiB | Las 4 rutas de `POST /api/v1/messages/send*` | El campo mas grande es `message` (max 4096 caracteres, hasta 16 KB en UTF-8 en el peor caso). 32 KiB deja margen para el resto de campos y la sobrecarga de JSON, y acota `components`/`action`, que no tienen limite de tamano en el esquema Zod. |
| `webhookBodyLimitBytes` | 8 KiB | `POST /api/v1/webhooks` | El cuerpo es una URL (max 2048 caracteres) y una lista de tipos de evento; no hay motivo para admitir mas. |

Las rutas de contactos/notas (`POST/PATCH /api/v1/contacts`,
`POST/PATCH .../notes`) se dejan deliberadamente en el limite global: el
campo `notes` admite hasta 20.000 caracteres y `custom_fields` no tiene techo
en el esquema actual, asi que un limite mas ajustado rechazaria peticiones
legitimas que la validacion Zod ya acepta. Ajustar eso (acotar
`custom_fields`) queda fuera de este alcance y se deja anotado como mejora
futura, no como hallazgo de seguridad.

### Respuesta ante cuerpo excesivo

Antes de este cambio, un cuerpo que supera `bodyLimit` producia un
`FastifyError` (`FST_ERR_CTP_BODY_TOO_LARGE`, `statusCode: 413`) que caia por
el manejador generico de `registerErrorHandlers` y salia como `500
internal_error` — un error crudo, con codigo equivocado, y ademas registrado
en el log como fallo inesperado. Ahora `src/http/errors.ts` reconoce ese
codigo especifico antes de llegar a la rama generica y responde:

```json
{
  "error": {
    "code": "payload_too_large",
    "message": "The request body exceeds the allowed size",
    "request_id": "req_..."
  }
}
```

con `413`.

### Pruebas (`test/body-limits.test.ts`)

5 pruebas: acepta un cuerpo dentro del limite global; rechaza uno por encima
del limite global con el sobre canonico; rechaza un cuerpo de mensaje que
supera el limite mas ajustado de esa ruta aunque quepa en el limite global
(prueba que el override por ruta realmente actua, no solo el global);
rechaza un registro de webhook por encima de su limite ajustado; acepta uno
dentro de el.

---

## B.6 — Auditoria de redaction

Estado previo: `src/server.ts` redactaba unicamente
`req.headers.authorization` y `req.headers.cookie`, y solo cuando se
arrancaba via `server.ts`. `buildApp` sin `logger` explicito caia en el
logger por defecto de Fastify (`true`), sin ninguna redaction.

### Hallazgos

#### 1. Query string sin redactar — **alto**

Fastify registra `req.url` tal cual en cada linea de log (`incoming
request`, `request completed`, ambas a nivel `info`, activas por defecto).
Esta API solo espera la clave por cabecera `Authorization`, pero un partner
puede pegarla por error en un parametro de query (`?token=pcp_...` o
similar), y quedaria en texto plano en cada linea de log de esa peticion, de
forma indefinida.

**Corregido**: `src/http/logging.ts` exporta `redactUrl()`, usada por un
`serializers.req` propio. Elimina cualquier subcadena con forma de clave
(`pcp_[a-f0-9]{64}`) en cualquier parte de la URL, y ademas vacia el valor de
un conjunto de nombres de parametro convencionalmente sensibles (`token`,
`api_key`, `apikey`, `key`, `secret`, `password`) sin importar su forma. Los
parametros benignos (`cursor`, `limit`) se mantienen visibles para no perder
utilidad de depuracion. Prueba directa en `test/redaction.test.ts`: un token
`pcp_...` en query string no aparece en la salida capturada del logger.

#### 2. `buildApp` sin logger explicito no redactaba nada — **medio**

`server.ts` es el unico punto que aplicaba redaction; `buildApp({...})` sin
`logger` caia en `true` (default de Fastify, sin `redact` ni serializers
propios). Cualquier uso futuro de `buildApp` fuera de `server.ts` (un
script, una tarea puntual) habria expuesto `Authorization` y `Cookie` en
claro.

**Corregido**: `secureLoggerOptions()` en `src/http/logging.ts` es ahora la
config compartida; `server.ts` la usa explicitamente y `buildApp` la usa
como fallback (`options.logger ?? secureLoggerOptions()`) en vez de `true`.

#### 3. `DeliveryAdapterError.response` guardaba el payload crudo del legacy como campo enumerable — **medio (latente, no explotado hoy)**

`src/delivery/client.ts` construye `DeliveryAdapterError(statusCode,
response)` con la respuesta completa del motor legacy, que puede incluir
telefono del cliente, contenido del mensaje o componentes de plantilla. Hoy
**no llega a ningun log ni a la respuesta HTTP**: `performDelivery` en
`src/routes/message-send.ts` captura este error explicitamente y devuelve un
mensaje generico `delivery_failed`, sin loguear nada en absoluto (ni
siquiera el codigo de estado — cero observabilidad del fallo).

El riesgo es de fragilidad, no de explotacion actual: `response` era un
campo publico enumerable. Si este error llegara alguna vez al manejador
generico (`request.log.error({ err: error }, ...)` en
`src/http/errors.ts`), el serializador `err` por defecto de pino copia todas
las propiedades enumerables propias del error — habria volcado el payload
completo del cliente al log, sin que nada lo impidiera.

**Corregido**: `response` ahora vive detras de un campo privado (`#response`)
con un getter (`src/delivery/client.ts`). Sigue siendo accesible para uso
legitimo (`error.response`), pero desaparece de `Object.keys(error)`, de
`JSON.stringify(error)` y de cualquier copia generica tipo `for...in` — que
es exactamente lo que hace el serializador de pino. Se añadio ademas una
linea de observabilidad real en `message-send.ts`: `request.log.warn({
statusCode: error.statusCode }, ...)`, solo con el codigo de estado, nunca
con el payload. Pruebas en `test/delivery-client.test.ts`: enumeracion
generica no incluye `response`; y si el error llega a un `log.error({err:
...})` generico (simulando el escenario de riesgo), el marcador de datos de
cliente no aparece en la salida capturada.

#### 4. Cuerpos de peticion — sin hallazgo, verificado

Se audito si algun `request.body` llega a un log. El serializador `req` por
defecto de Fastify (y el propio, en `secureLoggerOptions`) nunca incluye el
cuerpo, y ningun punto del codigo (`grep` de los tres unicos call sites de
`log.error`/`log.warn` existentes) registra `request.body` directamente. No
hay hallazgo activo, pero queda anotado: si en el futuro se añade logging de
depuracion que incluya el cuerpo de una peticion, debe pasar antes por
`secureLoggerOptions` o por una redaction equivalente — los campos como
`message`, `notes` o `custom_fields` pueden llevar datos de cliente.

### Resumen de severidad

| # | Hallazgo | Severidad | Estado |
| --- | --- | --- | --- |
| 1 | Query string sin redactar (token via `?token=pcp_...`) | Alto | Corregido |
| 2 | `buildApp` sin logger explicito no redactaba nada | Medio | Corregido |
| 3 | `DeliveryAdapterError.response` enumerable, volcable por el serializador `err` de pino | Medio (latente) | Corregido |
| 4 | Cuerpos de peticion en logs | — | Sin hallazgo (verificado, documentado) |

### Pruebas (`test/redaction.test.ts`, `test/delivery-client.test.ts`)

8 + 2 pruebas. Incluyen la prueba pedida explicitamente: un token `pcp_...`
en query string no aparece en la salida capturada del logger (via un sink
minimo pasado como `stream` al logger de Fastify/pino), junto con la cabecera
`Authorization` (regresion del comportamiento previo) y el caso del
`DeliveryAdapterError`.

---

## Que anadir a OpenAPI (no editado; `openapi/openapi.yaml` queda intacto)

1. **Respuesta `429`** reutilizable en `components/responses` (p. ej.
   `RateLimited`, con el mismo patron que `BadRequest`/`Forbidden`) apuntando
   a `ErrorResponse`, con una cabecera `Retry-After` documentada
   (`components/headers/RetryAfter: { schema: { type: integer }, description:
   "Seconds until the rate limit window resets" }`) y referenciada desde cada
   operacion bajo `/api/v1/*`.
2. **Respuesta `413`** (`PayloadTooLarge`) igual de reutilizable, referenciada
   al menos desde las operaciones `POST`/`PATCH`/`PUT` (contactos, notas,
   tags, mensajes, webhooks).
3. Documentar en la descripcion de cada operacion de escritura, o en un bloque
   general de la especificacion, los limites de cuerpo por ruta (32 KiB para
   `/messages/send*`, 8 KiB para `/webhooks`, 128 KiB global) para que los
   partners los conozcan de antemano.
4. Opcionalmente, una nota en la descripcion general de la API sobre los
   limites de peticion por defecto (300/clave, 600/IP, 1200/empresa por
   minuto), ya que son parte del contrato observable aunque no cambien el
   shape de ninguna operacion.

## Lo que esta entrega NO hace

- No habilita escrituras publicas (`READ_ONLY_MODE` sigue en `true` por
  defecto).
- No aplica ninguna migracion, no toca Docker ni la base de datos de
  produccion.
- No edita `openapi/openapi.yaml` (ver seccion anterior para lo pendiente).
- No implementa un rate limiter distribuido (ver limitacion declarada en
  B.4); solo documenta el camino para hacerlo.
- No acota `custom_fields` ni el tamano de `components`/`action` a nivel de
  esquema Zod (los limites de cuerpo por ruta son la mitigacion de esta
  fase, no un reemplazo de validacion mas fina).
- No cubre metricas de latencia/tasa de error ni retencion de idempotencia/
  outbox (resto del bloque 2 del plan de fase, pendiente 4 del bloque).
