# Auditoría de seguridad independiente: SSRF, media y aislamiento multiempresa

Fecha: 13 de agosto de 2026
Auditor: agente de seguridad independiente (sin acceso a las conclusiones previas del autor)
Rama auditada: `codex/integration-api-v1`
Alcance: `src/net/ip-rules.ts`, `src/net/destination.ts`, `src/net/safe-fetch.ts`,
`src/media/fetch.ts`, `src/media/store.ts`, `src/media/proxy.ts`, `src/routes/media.ts`,
`src/routes/message-send.ts` (parte de media), `src/routes/webhooks.ts`,
`src/webhooks/dispatcher.ts`, `src/resources/pipelines.ts`, `src/routes/pipelines.ts`,
más los archivos que estos importan directamente (`src/delivery/media-url.ts`,
`src/delivery/client.ts`, `src/webhooks/{signature,repository,deliveries,cipher,worker}.ts`,
`src/config.ts`, `src/server.ts`, `src/app.ts`) para trazar el flujo completo.

Metodología: lectura línea por línea de cada archivo en alcance, verificación empírica del
comportamiento real de Node.js (parsing de `URL`, `dns.lookup`, `net.connect`, `http.request`
con `lookup` personalizado) mediante scripts desechables, ejecución de la suite de pruebas
existente (`npx vitest run`, 231/231 verdes) y construcción de pruebas de concepto temporales
en `/tmp/claude-0/.../scratchpad` (no incorporadas al repositorio) para confirmar o descartar
cada sospecha antes de reportarla. No se modificó ningún archivo del repositorio salvo este
informe.

---

## Resumen de hallazgos

| # | Severidad | Archivo | Título |
|---|---|---|---|
| 1 | Alta (condicional a configuración) | `routes/message-send.ts`, `delivery/media-url.ts`, `config.ts` | SSRF residual por DNS rebinding en `send-media` cuando el proxy de media está desactivado, sin salvaguarda de configuración que lo impida |
| 2 | Informativa | `media/fetch.ts` | La coincidencia de content-type por prefijo acepta `image/svg+xml` y otros subtipos activos como "imagen" |
| 3 | Informativa | `net/ip-rules.ts` | Clasificación IPv6 incompleta para formas no canónicas de "IPv4-mapped" con grupo `ffff` desplazado (confirmado inerte en la práctica) |
| 4 | Informativa | `net/safe-fetch.ts` | El pinning de socket para IPs literales depende de una comprobación externa al `lookup`, por una particularidad de Node; riesgo de regresión futura, ya cubierto por prueba existente |
| 5 | Informativa | `webhooks/signature.ts` | `verifyWebhookSignature` es código muerto (no se usa en `src/` ni en `test/`) |

Ningún hallazgo crítico. Cero hallazgos en la clasificación IPv4, en la resolución de
hostnames de `destination.ts`, en la revalidación de redirecciones de `safe-fetch.ts`, en el
`dispatcher` de webhooks, ni en el aislamiento multiempresa de `resources/pipelines.ts` /
`routes/pipelines.ts`. El razonamiento y la prueba de cada intento de ruptura se documentan
más abajo, incluidos los que **no** lograron romper nada.

---

## Hallazgo 1 — SSRF residual por DNS rebinding en `send-media` sin proxy de media

**Severidad:** Alta (condicional; **no explotable en la configuración por defecto actual**,
pero explotable con un solo cambio de variable de entorno sin que el código lo impida)

**Archivos y líneas:**
- `src/routes/message-send.ts:145-151`
- `src/delivery/media-url.ts:1-14`
- `src/delivery/client.ts:68-96` (confirma que el motor legacy recibe la URL cruda)
- `src/config.ts:10-11,16` (`MEDIA_PROXY_ENABLED` por defecto `false`, `READ_ONLY_MODE` por
  defecto `true`)

**Descripción:**
`registerMessageSendRoutes` valida `media_url` una sola vez con `assertSafeMediaUrl`
(una resolución DNS puntual). Si `mediaProxy` es `undefined` — que es el caso por defecto,
porque `server.ts` solo construye un `DownloadingMediaProxy` cuando
`MEDIA_PROXY_ENABLED=true` —, la línea 150 usa `input.media_url` **sin modificar** como
`mediaUrl` y se lo entrega a `LegacyDeliveryClient.deliver()`, que lo reenvía tal cual al
motor legacy interno (`powerchat-app-bcousinoprop`, en la red Docker compartida). Ese motor
hace su propia descarga con su propio cliente HTTP, fuera del control de este código: no hay
pinning de socket, no hay revalidación de IP en el momento de la conexión.

Entre el instante en que esta API resuelve y valida el hostname y el instante en que el motor
legacy hace su propia resolución DNS existe una ventana de **DNS rebinding** clásica: un
atacante registra un dominio con TTL bajo que responde una IP pública en la primera consulta
(la de esta API) y una IP interna (`127.0.0.1`, `169.254.169.254`, un contenedor del
`powerchat-shared-network`, etc.) en la segunda consulta (la del motor legacy).

Esto está **explícitamente reconocido por los autores** en
`docs/api/DECISIONS-2026-08-13-SSRF.md` ("Riesgo residual declarado") y en
`docs/api/MEDIA-PROXY-2026-08-13.md`, y mitigado mediante dos flags independientes que hoy
están en su posición segura:
- `READ_ONLY_MODE=true` (por defecto) bloquea con `503` cualquier método distinto de
  `GET/HEAD/OPTIONS` en `/api/v1/*`, incluido `POST /api/v1/messages/send-media`
  (`src/app.ts:50-56`).
- `MEDIA_PROXY_ENABLED=false` (por defecto) hace que `mediaStore`/`mediaProxy` sean
  `undefined` y que ni siquiera se registre la ruta `/internal/media/:id`
  (`src/app.ts:134-136`).

El problema real que encontré, más allá de confirmar el riesgo ya documentado, es que
**`config.ts` no impone ninguna relación entre ambas variables**. `configSchema.superRefine`
sólo exige `MEDIA_INTERNAL_BASE_URL` cuando `MEDIA_PROXY_ENABLED=true`; no existe ninguna
regla que impida arrancar con `READ_ONLY_MODE=false` y `MEDIA_PROXY_ENABLED=false` a la vez,
que es exactamente la combinación que reabre este SSRF. Si en el futuro alguien activa
escrituras (`READ_ONLY_MODE=false`) para habilitar `send-message`/`send-template` sin recordar
que `send-media` depende de una segunda variable, el servicio arranca sin error y el hueco
queda abierto silenciosamente — el propio documento de decisiones lo advierte en prosa
("No debe habilitarse..."), pero nada en el código lo hace cumplir.

**Reproducción concreta (con la configuración de riesgo activa):**
1. `READ_ONLY_MODE=false`, `MEDIA_PROXY_ENABLED=false` (arranca sin error: no hay validación
   cruzada).
2. Un partner autenticado con scope `messages:send` llama:
   ```
   POST /api/v1/messages/send-media
   { "channel_id": "5", "to": "+56911112222",
     "media_type": "image",
     "media_url": "https://rebinding-attacker.example/a.png" }
   ```
3. `rebinding-attacker.example` responde `93.184.216.34` (pública) a la resolución que hace
   `assertSafeMediaUrl` en esta API — pasa la validación.
4. Con TTL bajo, el mismo nombre responde `169.254.169.254` (o una IP del
   `powerchat-shared-network`) cuando el motor legacy hace su propia resolución al descargar
   la URL que se le reenvió sin modificar.
5. El motor legacy — cuyo código está fuera de este repositorio — hace la petición HTTP hacia
   el destino interno con las credenciales/contexto que tenga en ese momento.

Confirmé cada eslabón de esta cadena leyendo el código (no pude ejecutar el motor legacy real,
que está fuera del repositorio auditado), y confirmé que hoy ninguno de los dos flags permite
que la cadena se dispare.

**Impacto real:** si se activa sin resolver el punto 3 de "Lo que FALTA antes de activarlo" en
`docs/api/MEDIA-PROXY-2026-08-13.md`, un partner externo puede usar `send-media` como vector
SSRF hacia la red Docker/VPS interna a través del motor legacy, que es exactamente el sistema
que la Fase de hardening SSRF pretendía proteger.

**Corrección propuesta:**
1. Añadir a `configSchema.superRefine` en `src/config.ts` una regla que impida arrancar con
   `READ_ONLY_MODE=false` y `MEDIA_PROXY_ENABLED=false` simultáneamente (o, más estricto:
   que falle si `READ_ONLY_MODE=false` y `MEDIA_PROXY_ENABLED` no es `true`), de modo que la
   protección deje de depender solo de la disciplina operativa/documental.
2. Alternativamente (o además), en `routes/message-send.ts`, si `mediaProxy` es `undefined`,
   rechazar la petición con un error explícito (`503`/`422`) en vez de hacer *fallback*
   silencioso a reenviar `input.media_url` — así el fallo es ruidoso, no silencioso.

**Prueba de regresión sugerida:** un test en `test/config.test.ts` que verifique que
`loadConfig({ ...validEnv, READ_ONLY_MODE: "false", MEDIA_PROXY_ENABLED: "false" })` lanza
(análogo al test ya existente para `MEDIA_PROXY_ENABLED=true` sin `MEDIA_INTERNAL_BASE_URL`).

---

## Hallazgo 2 — `image/svg+xml` (y otros subtipos activos) se aceptan como "imagen"

**Severidad:** Informativa

**Archivo y línea:** `src/media/fetch.ts:26-32` (`contentTypeMatches`)

**Descripción:** Para `kind !== "document"`, la validación es
`normalized.startsWith(\`${kind}/\`)`. Cualquier subtipo cuenta, incluido `image/svg+xml`.
Un SVG puede contener `<script>` embebido. Verifiqué con una PoC temporal (no incluida en el
repo) que `fetchRemoteMedia(url, "image", policy)` acepta y almacena sin queja un SVG con
`<script>alert(document.domain)</script>` embebido, devolviendo `contentType: "image/svg+xml"`.

**Reproducción concreta:** servir desde una URL controlada por el partner un cuerpo
`<svg xmlns="http://www.w3.org/2000/svg"><script>...</script></svg>` con
`Content-Type: image/svg+xml` como respuesta a `media_type: "image"`.

**Impacto real:** depende enteramente de cómo consuma esos bytes el destinatario final (el
motor legacy y, en última instancia, el proveedor del canal — p. ej. WhatsApp Cloud API), que
está fuera del alcance de este repositorio. Dentro del alcance auditado, `routes/media.ts`
sirve el contenido con `x-content-type-options: nosniff` y sin autenticación, pensado para
consumo servidor-a-servidor, no para renderizado en un navegador de un tercero. No encontré
ninguna ruta dentro de este repositorio que exponga el SVG a un `<img>`, `<iframe>` o
navegación de nivel superior de un usuario final, así que no pude demostrar una ejecución de
script real dentro del alcance auditado. Lo clasifico como informativo porque es una brecha de
validación real y de bajo costo de arreglar, no porque haya probado explotación.

**Corrección propuesta:** mantener una lista explícita de subtipos permitidos por `kind`
(p. ej. `image/jpeg`, `image/png`, `image/webp` para `"image"`) en vez de coincidencia por
prefijo, igual que ya se hace por lista negra para `"document"`.

**Prueba de regresión sugerida:** `fetchRemoteMedia(url, "image", policy)` con
`content-type: image/svg+xml` debe lanzar `media_type_mismatch`.

---

## Hallazgo 3 — Clasificación IPv6 incompleta para "IPv4-mapped" con grupo desplazado (confirmado inerte)

**Severidad:** Informativa (gap de clasificación demostrado, explotabilidad descartada
empíricamente)

**Archivo y línea:** `src/net/ip-rules.ts:83-101` (`blockedIpv6`)

**Descripción:** El bloque IPv4-mapeada exige que `ffff` esté exactamente en `bytes[10:12]`
(`allZero(bytes,0,10) && bytes[10]===0xff && bytes[11]===0xff`). Una dirección literal como
`::ffff:0:127.0.0.1` es sintácticamente válida (`net.isIP` de Node la reconoce como IPv6) y
tras el parseo del propio módulo coloca el grupo `ffff` en `bytes[8:10]`, no en `bytes[10:12]`
— porque la representación textual mete un grupo `0` explícito entre `ffff` y la IPv4
incrustada. El resultado, `0:0:0:0:ffff:0:7f00:1`, no coincide con el prefijo IPv4-mapeada
exacto, no cae en el bloque `::/96` (bytes 0-11 no son todo cero: bytes[8:10] son `ff ff`), y
tampoco coincide con ningún otro rango bloqueado. `isBlockedIpAddress("::ffff:0:7f00:1")`
devuelve `false`.

Confirmé que esta forma es alcanzable como IP literal a través de la API real: `new
URL("http://[::ffff:0:127.0.0.1]/").hostname` canoniza a `[::ffff:0:7f00:1]`, que es
exactamente lo que `assertSafeAddresses` recibiría como `url.hostname`. Lo mismo aplica con
cualquier IPv4 bloqueada incrustada (`::ffff:0:169.254.169.254` → `::ffff:0:a9fe:a9fe`,
también no bloqueada por el clasificador).

**Por qué lo bajo a informativo:** hice la prueba decisiva — abrir una conexión TCP real desde
este mismo entorno Linux a `::ffff:0:7f00:1` contra un servidor escuchando en `127.0.0.1` — y
la conexión **no llega a destino** (timeout, sin ruta). El kernel/glibc solo trata como
"IPv4-mapeada" el prefijo exacto `::ffff:0:0/96`; esta forma desplazada es, para el sistema
operativo, una dirección IPv6 global corriente sin ningún significado especial, dentro de un
bloque (`0000::/8` salvo sub-rangos específicos) no asignado en Internet. No logré demostrar
que esta forma alcance loopback, la red Docker ni metadatos de nube — es un hueco real en la
*completitud* del clasificador, pero no un bypass SSRF *practicable* con el direccionamiento
IPv6 actual.

**Reproducción concreta (solo para el gap de clasificación, no para SSRF real):**
```js
isBlockedIpAddress("::ffff:0:7f00:1")          // false — debería ser irrelevante en la práctica
isBlockedIpAddress("::ffff:0:a9fe:a9fe")       // false — 169.254.169.254 desplazada
```

**Corrección propuesta (higiene, no urgente):** en vez de buscar el patrón `ffff` en una
posición fija, recorrer los bytes 0–9 buscando cualquier variante razonable, o —más simple y
robusto— rechazar por defecto cualquier dirección IPv6 que contenga una subcadena decimal
punteada de 4 octetos en su forma textual original salvo que encaje exactamente en los
prefijos reconocidos, en vez of confiar en la re-serialización a grupos hexadecimales.

**Prueba de regresión sugerida:** añadir `"::ffff:0:7f00:1"` y `"::ffff:0:a9fe:a9fe"` a la
lista `blocked` de `test/ssrf.test.ts` documentando que hoy fallan (`isBlockedIpAddress`
devuelve `false`), para que quede registrado como deuda conocida en vez de un olvido.

---

## Hallazgo 4 — El pinning de IP literal depende de una comprobación separada del `lookup`

**Severidad:** Informativa (no explotable hoy; riesgo de regresión de mantenimiento)

**Archivo y línea:** `src/net/safe-fetch.ts:36-58` (`guardedLookup`) y `:162-167` (comprobación
previa en el bucle de `safeFetch`)

**Descripción:** Confirmé empíricamente (con `net.http.request` puro, fuera del código
auditado) que **Node.js no invoca la función `lookup` personalizada cuando el `hostname` ya es
una dirección IP literal** — la conexión se hace directamente con esa IP, sin pasar por
`dns.lookup`. Esto significa que `guardedLookup`, pese al comentario que dice "Pinning real en
el socket", **nunca se ejecuta para destinos con IP literal**. La única razón por la que ese
caso sigue siendo seguro es la llamada explícita `await assertSafeAddresses(url.hostname, ...)`
en la línea 163 del bucle de `safeFetch`, que se ejecuta *antes* de `performRequest` en cada
salto (incluida la petición inicial y cada redirección). El propio diario de decisiones
(`docs/api/DECISIONS-2026-08-13-SSRF.md`, punto 5) documenta correctamente esta razón.

No encontré ningún camino donde `performRequest` se invoque sin haber pasado antes por esa
comprobación — verifiqué las dos únicas rutas (`safeFetch` inicial y cada iteración del bucle
de redirección) y ambas la incluyen. La suite existente (`test/ssrf.test.ts`, caso "refuses a
literal loopback destination under the real policy") ya ejercita este camino exacto contra un
servidor HTTP real en `127.0.0.1` con la política por defecto, así que una regresión que
elimine esa comprobación por parecer "redundante con `guardedLookup`" haría fallar ese test
(el `safeFetch` conectaría con éxito al servidor de prueba en vez de lanzar). Marco esto como
informativo porque hoy está cubierto, tanto en código como en pruebas; lo incluyo porque el
comentario del código no deja explícito *por qué* esa línea es indispensable y no redundante,
lo que la hace un candidato natural a "limpieza" en un refactor futuro sin que quien lo haga
entienda que está retirando la única defensa para ese caso.

**Reproducción concreta:**
```js
const called = { value: false };
http.request({ hostname: "127.0.0.1", port: 1, lookup: (h, o, cb) => { called.value = true; cb(new Error("x"), "", 0); } })
  .on("error", () => console.log("lookup fue invocado:", called.value)); // false
```

**Impacto real:** ninguno hoy. Es una nota de mantenibilidad.

**Corrección propuesta:** ampliar el comentario en `safe-fetch.ts` justo encima de la
comprobación de la línea 163 explicando, con estas palabras o similares, que esa llamada es la
**única** validación para destinos con IP literal porque Node omite `lookup` en ese caso, y que
no debe eliminarse aunque parezca redundante con `guardedLookup`.

**Prueba de regresión sugerida:** ya existe (`test/ssrf.test.ts`); no se requiere una nueva,
pero convendría añadir un comentario en el propio test señalando qué invariante protege
específicamente.

---

## Hallazgo 5 — `verifyWebhookSignature` es código muerto

**Severidad:** Informativa

**Archivo y línea:** `src/webhooks/signature.ts:8-17`

**Descripción:** `grep -rn "verifyWebhookSignature" src/ test/` fuera del propio archivo no
devuelve resultados: la función se exporta pero no se invoca en ningún sitio del repositorio.
No es un problema de seguridad — el diseño de firma HMAC en sí es correcto (ver más abajo) —
pero código de verificación sin ejercitar por pruebas ni por otras rutas es más fácil que se
desactualice silenciosamente si algún día se usa como referencia para un endpoint de
verificación interno.

**Impacto real:** ninguno directamente explotable.

**Corrección propuesta:** si es una utilidad pensada solo como referencia para partners,
documentarlo en el comentario; si no tiene uso previsto, considerar retirarla o cubrirla con
una prueba unitaria mínima para que no quede huérfana.

---

## Áreas revisadas donde NO encontré fallos explotables (y por qué las considero sólidas)

### `net/ip-rules.ts` — clasificación de direcciones IPv4/IPv6

Verifiqué cada rango contra el registro IANA de direcciones especiales y contra los 39 casos
"bloqueados" y 13 "permitidos" de `test/ssrf.test.ts`, y añadí mis propios intentos de bypass:

- **Decimal, octal, hex, formas cortas de IPv4** (`2130706433`, `0x7f000001`, `017700000001`,
  `127.1`, `0177.0.0.1`, `0x7f.0.0.1`): confirmé con Node real que el parser `URL` de WHATWG
  **normaliza todas estas formas a la notación decimal con puntos canónica** (`127.0.0.1`)
  *antes* de que `url.hostname` llegue a `ip-rules.ts`, para los esquemas especiales `http`/
  `https` que son los únicos permitidos aquí. El módulo de clasificación nunca ve estas formas
  crudas.
- **Ceros a la izquierda:** el regex interno de `net.isIP` de Node ya las rechaza a nivel de
  octeto individual; y aunque no las rechazara, la normalización de `URL` las resuelve primero.
- **Hostname con punto final** (`127.0.0.1./`): también normalizado por `URL` a la forma sin
  punto final antes de llegar aquí.
- **IPv4 mapeada/compatible/NAT64/6to4 en sus formas canónicas:** `::ffff:127.0.0.1`,
  `::ffff:169.254.169.254`, `::ffff:172.16.0.1`, `::ffff:100.64.0.1`, `::ffff:192.168.1.1`,
  `64:ff9b::127.0.0.1`, `2002::1` — todas correctamente bloqueadas, verificado con
  `isBlockedIpAddress` y con la suite existente.
- **Falsos positivos sobre direcciones públicas:** verifiqué los límites exactos de cada rango
  (`172.15.255.255` permitida / `172.16.0.0` bloqueada; `100.63.255.255` permitida /
  `100.64.0.0` bloqueada; `192.0.1.1` permitida / `192.0.0.1` y `192.0.2.1` bloqueadas;
  `198.20.0.1` permitida / `198.18.0.0`–`198.19.255.255` bloqueado; `199.0.113.9` permitida /
  `203.0.113.0/24` bloqueado) y ningún caso produjo un falso positivo ni un falso negativo en
  los límites.
- **Unicode / homoglifos** (`①②➈.0.0.1`): el propio parser `URL` rechaza el hostname como
  inválido antes de llegar a ningún código de este repositorio.
- El único gap real que encontré es el del Hallazgo 3, y quedó demostrado inerte en la
  práctica.

### `net/destination.ts` — resolución y políticas de destino

- Hostname en mayúsculas, con punto final, o con corchetes de IPv6: todos normalizados
  correctamente antes de la clasificación (confirmado con pruebas directas de `new URL()`).
- Lista vacía de direcciones resueltas → `UnsafeDestinationError` (`addresses.length === 0`).
- El resolver que lanza una excepción → capturado y convertido en `UnsafeDestinationError`, no
  se propaga un error no controlado.
- Exige que **todas** las direcciones resueltas sean públicas, no solo la primera — cierra la
  carrera de "responde una pública y una privada". Verificado leyendo el código y con el test
  existente `"rejects a hostname that mixes a public and a private address"`.
- Credenciales en la URL (`user:pass@host`) rechazadas explícitamente.

### `net/safe-fetch.ts` — pinning, redirecciones y presupuesto

- Cada salto de redirección se revalida de forma independiente contra la política de
  seguridad; ningún salto hereda el veredicto del anterior (confirmé el flujo y el test
  `"revalidates every redirect hop and refuses one pointing at a blocked address"`, donde el
  primer salto se permite explícitamente y el segundo se bloquea con un mock que lo fuerza).
- El presupuesto de redirecciones agotado **lanza una excepción**, nunca devuelve el cuerpo de
  una respuesta de redirección no validada — verificado leyendo el orden exacto de las
  comprobaciones (primero se determina si hay más redirecciones que seguir; solo si las hay se
  comprueba el presupuesto).
- Por defecto `maxRedirects: 0`: ninguna llamada real en el código (`webhooks/dispatcher.ts`,
  `media/fetch.ts`) activa el seguimiento de redirecciones hoy — es una ruta implementada y
  probada pero actualmente inactiva en producción, lo cual reduce aún más la superficie.
- El límite de tamaño de respuesta se aplica por streaming de bytes reales recibidos, no solo
  por `content-length` declarado, así que `transfer-encoding: chunked` sin `content-length` no
  lo evade — la conexión se destruye (`message.destroy()`) en cuanto se supera el límite.
- SNI/TLS: `servername` se fija al hostname declarado (no a la IP conectada) cuando no es una
  IP literal, preservando la validación de identidad TLS correcta independientemente de a qué
  dirección se conectó realmente el pinning.

### `media/fetch.ts`, `media/store.ts`, `routes/media.ts`

- Sin consumo ilimitado de memoria: el límite se aplica en streaming (ver arriba), acotado por
  `MEDIA_MAX_BYTES` (1 KiB–100 MiB, validado por `config.ts`).
- `content-encoding: gzip` no descomprime en ningún punto del código (usa `node:http`/`https`
  crudo, no `fetch`/undici), así que no hay "bomba de descompresión" posible — en el peor caso
  se almacenarían bytes comprimidos mal etiquetados, un problema funcional, no de seguridad.
- Path traversal en `store.get`: el identificador se valida contra
  `/^[a-f0-9]{64}$/` **antes** de tocar el sistema de archivos; cualquier intento de
  `../../etc/passwd` o similar falla el regex y nunca llega a `join()`/`readFile()`. Probé
  mentalmente varias variantes (`..%2f`, rutas absolutas, null bytes) y todas fallan el mismo
  regex por no ser 64 caracteres hexadecimales en minúscula.
- `/internal/media/:id`: errores de formato inválido, archivo inexistente y fallo de
  lectura del sistema de archivos colapsan todos al mismo `404 media_not_found` sin distinguir
  el motivo — no hay oráculo de mensajes de error. Hay una diferencia de timing entre "rechazo
  por regex" (inmediato) y "rechazo por `ENOENT`" (tras I/O), pero no es explotable: no ayuda a
  localizar uno entre 2^256 identificadores válidos.
- Filtración entre empresas: el identificador nunca se devuelve al partner en ninguna
  respuesta de la API (confirmé con `grep` que `stored.url`/`mediaUrl` solo viaja hacia
  `delivery.deliver()`, nunca hacia el cuerpo de respuesta del endpoint público). La ruta
  interna depende, además, de que Nginx deniegue el prefijo `/_integration-api/internal/`
  externamente — el snippet existe y está probado en `test/deployment.test.ts`, pero los
  propios documentos del proyecto (`docs/api/MEDIA-PROXY-2026-08-13.md`, punto 2) señalan que
  **todavía no está aplicado en el vhost real**; eso es una tarea operativa fuera de este
  repositorio, no un defecto de código, pero es directamente relevante para la pregunta de si
  conviene habilitar el proxy de media ahora mismo.

### `routes/webhooks.ts` y `webhooks/dispatcher.ts`

- El registro exige HTTPS y resuelve DNS antes de aceptar la URL.
- El *dispatcher* **nunca usa `fetch` global**: usa `createSafeFetch({ timeoutMs: 15000 })`
  (redirecciones desactivadas por defecto), que revuelve y valida DNS en **cada intento de
  entrega**, no solo en el registro — así que un dominio "repunteado" después del registro pero
  antes de la primera entrega es detectado en el propio intento de entrega, no se hereda
  ningún veredicto antiguo. Esto responde directamente a la pregunta del alcance sobre qué
  impide el repunteo: la revalidación en cada intento, verificada leyendo `dispatcher.ts` y
  `worker.ts` (el worker solo llama a `dispatchBatch` con el `fetcher` seguro por defecto).
- El secreto del webhook se genera con `randomBytes(32)`, se guarda cifrado
  (`AES-256-GCM`, con nonce aleatorio por registro) más un hash SHA-256 independiente para
  búsquedas, y solo se devuelve al cliente **una vez**, en la respuesta de creación —
  `GET /api/v1/webhooks` lo excluye explícitamente en el mapeo `endpoint()`. No encontré ningún
  camino de log que lo exponga (el logger de Fastify solo redacta cabeceras por configuración,
  pero el secreto tampoco pasa nunca por una cabecera ni por un log explícito del código
  auditado).
- La firma HMAC se calcula sobre la **misma variable de cadena** (`body`) que se envía como
  cuerpo de la petición (`signWebhook(timestamp, body, item.secret)` seguido de
  `new Request(item.url, { body, ... })`), así que no hay divergencia posible entre lo firmado
  y lo transmitido por una doble serialización.
- `verifyWebhookSignature` usa `timingSafeEqual` con una comprobación de longitud previa que
  evita la excepción que lanzaría `timingSafeEqual` con buffers de distinto tamaño (y por tanto
  evita un oráculo de longitud).

### `resources/pipelines.ts` y `routes/pipelines.ts` — aislamiento multiempresa

Repasé cada una de las cinco consultas SQL (`listPipelines`, `listStages`, `listDeals`,
`findDeal`, `listTasks`):

- Las cinco filtran por `company_id = $N` de forma parametrizada; no hay concatenación de
  cadenas con entrada de usuario en ninguna consulta (`DEAL_COLUMNS`/`DEAL_SOURCE` son
  constantes fijas del módulo, no derivadas de la petición) — no hay inyección SQL posible.
- El `LEFT JOIN` de `stage_name` (`DEAL_SOURCE`) exige **simultáneamente**
  `pipeline_stages.id = deals.stage_id`, `pipeline_stages.pipeline_id = deals.pipeline_id` **y**
  `pipeline_stages.company_id = deals.company_id`. Analicé el caso borde explícito que pide el
  alcance: un `deals.stage_id` que apunta a una fila de `pipeline_stages` existente pero de
  **otro** pipeline o de **otra** empresa. En ambos casos el `AND` adicional hace que el `JOIN`
  no encuentre fila y `stage_name` sale `NULL` — nunca el nombre de una etapa ajena. Esto está
  cubierto por prueba según `docs/api/PIPELINE-RESOURCES-2026-08-13.md` y coincide con lo que
  observo en el código; no encontré ninguna combinación de IDs que lo eluda porque las tres
  condiciones del `JOIN` son obligatorias, no opcionales.
- `listStages` comprueba la pertenencia del pipeline dos veces: una vez por existencia
  (`EXISTS(...WHERE id=$1 AND company_id=$2)`, devolviendo `null`→404 si falla) y otra vez
  dentro de la propia consulta de etapas (`pipeline_stages.company_id = $2 AND
  pipeline_stages.pipeline_id = $1 AND pipelines.company_id = $2`), evitando que una etapa con
  el mismo `pipeline_id` pero de otra empresa se cuele si algún día los IDs dejan de ser
  globalmente únicos.
- `findDeal` (`GET /api/v1/deals/:id`) filtra por `deals.company_id = $1 AND deals.id = $2`; un
  ID de otra empresa no produce fila y el endpoint devuelve `404 deal_not_found`, nunca datos de
  otra empresa. Igual para `listDeals`/`listTasks` con sus filtros opcionales
  (`pipeline_id`, `contact_id`), que se aplican **además** del filtro de empresa, no en su
  lugar.
- La paginación por cursor (`cursorParameters`, reutilizada de `resources/core.ts`) no depende
  de información secreta ni permite saltarse el filtro de empresa: el cursor solo aporta
  `(created_at, id)` para el `WHERE ... < (...)`, y el `company_id = $1` se aplica siempre en
  la misma cláusula `WHERE`, así que un cursor robado o adivinado de otra empresa no amplía el
  resultado más allá de lo que ya permite `company_id` de la clave usada.
- `identifier()` en `routes/pipelines.ts` exige `^\d+$` antes de convertir a `Number`, evitando
  cualquier valor no numérico llegue a la capa de repositorio.

No encontré ninguna consulta que use `OR company_id IS NULL` ni ninguna ruta que omita el
filtro de empresa.

---

## Verificación de ejecución

- `npx vitest run` → **231/231 pruebas verdes** en las 15 suites (incluye `ssrf.test.ts`,
  `media-proxy.test.ts`, `pipeline-repository.test.ts`, `pipeline-resources.test.ts`,
  `tenant-isolation.test.ts`, `webhooks.test.ts`, `config.test.ts`, `deployment.test.ts`), sin
  ninguna modificación de código de producción ni de pruebas.
- PoCs desechables ejecutadas fuera del repositorio (en el directorio scratchpad de esta
  sesión, nunca escritas dentro de `integration-api/`): normalización de `URL` para IPv4
  decimal/octal/hex, comportamiento de `net.isIP` con zona IPv6, conexión TCP real a la forma
  IPv6 desplazada del Hallazgo 3 (confirmó que no enruta a ningún sitio), aceptación de un SVG
  con `<script>` como `media_type: "image"`, y confirmación de que `lookup` no se invoca para
  IPs literales en `http.request`.

---

## Veredicto sobre habilitar escrituras

**Para `send-message`, `send-template`, `send-interactive`, webhooks y los recursos de
lectura de pipelines/deals/tasks:** no encontré ningún hallazgo que impida habilitar
escrituras. El aislamiento multiempresa es sólido en todo lo auditado, la defensa SSRF de
`net/` es correcta en todos los caminos alcanzables desde la API pública, y el *dispatcher* de
webhooks revalida en cada intento de entrega en vez de confiar en el registro.

**Para `send-media` específicamente: no recomiendo habilitar `READ_ONLY_MODE=false` sin
haber puesto también `MEDIA_PROXY_ENABLED=true`** y sin haber completado los cinco puntos que
el propio equipo ya listó como pendientes en `docs/api/MEDIA-PROXY-2026-08-13.md` (volumen
escrituble, regla de Nginx aplicada en el vhost real, alcanzabilidad del motor legacy a
`MEDIA_INTERNAL_BASE_URL`, límites reales del proveedor, E2E autorizado). El código que cierra
el riesgo ya existe y está bien construido (Hallazgo 1 lo confirma independientemente), pero
hoy nada en el propio código impide arrancar en la combinación insegura; recomiendo la
validación cruzada en `config.ts` descrita en el Hallazgo 1 antes de considerar ese interruptor
seguro de operar por terceros.

Los hallazgos 2 a 5 son mejoras de defensa en profundidad y de mantenibilidad, no bloqueantes.
