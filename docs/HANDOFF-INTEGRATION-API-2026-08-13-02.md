# Relevo 02: Zinto Integration API tras el endurecimiento SSRF

Fecha: 13 de agosto de 2026
Rama: `codex/integration-api-v1`
Commit de GitHub y del VPS: `3417c32cd37149fd728a7af08beb330775c15a52`
Continua el relevo original `docs/CLAUDE-HANDOFF-INTEGRATION-API-2026-08-13.md`,
que sigue siendo el runbook vigente. Este documento solo actualiza el estado.

> **La API NO esta terminada.** Ver "Lo que falta" al final. No la presentes a un
> integrador como completa.

## Resumen para el propietario

Se cerro el pendiente prioritario 2 del runbook (SSRF) y se completo la
auditoria de aislamiento multiempresa de la Fase B.7. El preview desplegado
sigue siendo de solo lectura. No se aplico la migracion, no se activo el worker,
no se toco el CRM compilado y no se abrio ninguna sesion Baileys.

## Estado desplegado y verificado

Verificacion ejecutada tras el despliegue del 13 de agosto de 2026:

| Comprobacion | Resultado |
| --- | --- |
| Commit en GitHub (`origin/codex/integration-api-v1`) | `3417c32` |
| Commit en el worktree del VPS | `3417c32` |
| Label `org.opencontainers.image.revision` de la imagen | `3417c32` |
| `/app/RELEASE` dentro del contenedor | `3417c32` |
| `GET /_integration-api/health` | `200` |
| `GET /_integration-api/ready` | `200` (dependencia DB lista) |
| `GET /_integration-api/api/v1/me` sin clave | `401 missing_api_key` |
| `POST /_integration-api/api/v1/contacts` | `403` en Nginx |
| `PATCH` / `PUT` / `DELETE` sobre `/api/v1/*` | `403` en Nginx |
| `GET https://crm.zinto.app/inbox` | `200` |
| `GET https://crm.zinto.app/` | `200` |
| `GET https://crm.zinto.app/login` | `200` |

Las cuatro fuentes de verdad del commit coinciden, que es exactamente lo que el
paso A6 del runbook exigia y antes no era posible comprobar.

### Ajustes de seguridad intactos

| Ajuste | Valor efectivo en el contenedor |
| --- | --- |
| `READ_ONLY_MODE` | `true` |
| `WEBHOOK_WORKER_ENABLED` | `false` |
| `NODE_ENV` | `production` |
| Rootfs de solo lectura | `true` |
| Capacidades | `CapDrop: [ALL]` |
| `no-new-privileges` | `true` |
| Usuario | `uid=1000(node)` |
| Puerto publicado | solo `127.0.0.1:3100` |

### Migracion

`migrations/001_integration_api.sql` **NO esta aplicada**. Comprobado por
consulta directa: no existe ninguna tabla `integration_api%` en la base de datos
del CRM. Por tanto `GET /api/v1/webhooks` sigue sin poder probarse en este
preview, igual que advertia el relevo original.

## Los tres hallazgos SSRF corregidos

### 1. El registro de webhooks no resolvia DNS — severidad alta

**Evidencia:** `src/routes/webhooks.ts`, funcion `assertSafeWebhookUrl` en el
commit `ddc5de3`. Solo comprobaba protocolo HTTPS, ausencia de credenciales,
hostname distinto de la cadena literal `localhost` y que el hostname no fuera
una IP literal.

**Reproduccion:** registrar un webhook con un nombre de dominio publico cuyo
registro A apunte a `127.0.0.1`, `10.0.0.5` o `169.254.169.254`. La validacion
lo aceptaba porque nunca resolvia el nombre.

**Correccion:** el registro resuelve DNS y aplica la politica completa de
direcciones. Regresion cubierta en `test/ssrf.test.ts`.

### 2. El dispatcher entregaba con el `fetch` global — severidad alta

**Evidencia:** `src/webhooks/dispatcher.ts`, `dispatchBatch(repository, fetcher = fetch)`.

**Reproduccion:** un endpoint registrado como publico se repunta despues a una
direccion interna, o responde `302` hacia ella. `fetch` sigue redirecciones por
defecto y no comprueba el destino, de modo que la peticion firmada llegaba a la
red interna.

**Correccion:** el dispatcher usa `createSafeFetch`. Las redirecciones estan
prohibidas por defecto y el destino se autoriza en cada conexion.

### 3. Clasificacion de direcciones incompleta — severidad media

**Evidencia:** `src/delivery/media-url.ts`, funciones `privateIpv4` y
`privateIpv6` en `ddc5de3`.

**Reproduccion:** faltaba CGNAT `100.64.0.0/10`, que el runbook exigia de forma
explicita, y tambien `192.0.0.0/24`, `198.18.0.0/15` y los rangos TEST-NET. En
IPv6 el tratamiento de direcciones IPv4 mapeadas era por prefijo de texto y solo
contemplaba `::ffff:127.`, `::ffff:10.` y `::ffff:192.168.`, asi que pasaban
`::ffff:172.16.0.1`, `::ffff:169.254.169.254`, `::ffff:100.64.0.1` y la forma
hexadecimal equivalente `::ffff:7f00:1`. Tampoco se cubrian NAT64 `64:ff9b::/96`
ni 6to4 `2002::/16`.

**Correccion:** `src/net/ip-rules.ts` parsea IPv6 a bytes y desenvuelve toda
forma que pueda transportar una IPv4 incrustada para reevaluarla con las reglas
IPv4. Lo que no se puede parsear se bloquea. Cubierto por una tabla de 39
direcciones bloqueadas y 13 permitidas.

### Diseno de la correccion

- Un solo componente compartido por media, registro de webhooks y entrega, para
  que no existan dos definiciones de "direccion segura" que puedan divergir.
- Se exige que **todas** las direcciones resueltas de un nombre sean publicas,
  no solo la elegida, lo que elimina la carrera en la que el runtime escoge la
  privada.
- `src/net/safe-fetch.ts` pasa su propio `lookup` a `node:http`/`node:https`: la
  direccion validada es exactamente la que recibe el socket. Eso es lo que cierra
  la ventana de rebinding que deja un diseno "validar y luego hacer fetch". Las
  IP literales se validan aparte porque Node no llama a `lookup` cuando el host
  ya es una IP.
- Redirecciones prohibidas por defecto; cuando se permiten, cada salto se
  resuelve y se autoriza de nuevo sin heredar el veredicto anterior.
- Limite de 1 MiB en la respuesta del destino.

## RIESGO RESIDUAL: media URL y DNS rebinding en el motor legacy

**Este es el riesgo abierto mas importante de esta entrega.**

La API valida y autoriza el destino de `media_url`, pero **no realiza la descarga**:
la URL se entrega al motor legacy (`powerchat-app-bcousinoprop`), que abre su
propia conexion con su propio cliente HTTP.

Consecuencia: entre nuestra validacion y la descarga del motor existe una
ventana de DNS rebinding. Un atacante puede publicar un nombre con TTL muy bajo
que responda una direccion publica cuando nosotros validamos y una direccion
interna cuando el motor descarga. Nuestro pinning protege nuestras conexiones,
no las del motor legacy.

**Mitigacion actual:** las escrituras estan deshabilitadas por partida doble
(Nginx bloquea los verbos mutantes y `READ_ONLY_MODE=true`), de modo que hoy no
es explotable en el preview.

**Condicion de cierre.** No habilitar el envio de media a terceros hasta que se
cumpla de forma verificable una de estas opciones:

1. El motor legacy descarga a traves de un cliente con la misma politica de
   pinning y sin redirecciones; o
2. la API descarga la media con `safe-fetch`, la deposita en almacenamiento
   controlado y entrega al motor una URL interna de confianza; o
3. solo se aceptan URLs de un conjunto explicito de dominios de almacenamiento
   permitidos por empresa.

La opcion 2 es la mas robusta y la unica que no depende de modificar el
compilado. Hasta entonces, `POST /api/v1/messages/send-media` no debe habilitarse
para ningun piloto.

## Aislamiento multiempresa: auditado, sin hallazgos

Auditoria sistematica en `test/tenant-isolation.test.ts`. Se siembran contacto,
nota, canal, conversacion y webhook de la empresa 77 y se ataca cada ruta con una
clave de la empresa 12.

Resultado: las nueve rutas con ID ajeno devuelven `404`, las listas salen
vacias, no se filtra ningun dato del titular, ningun repositorio registra
escritura y un contacto creado queda ligado a la empresa de la clave y nunca a
una suministrada por el cliente.

Revision del SQL real: todas las consultas de `resources/core.ts` y
`resources/contact-mutations.ts` filtran por `company_id`; `listMessages`
comprueba ademas la propiedad de la conversacion y vuelve a unir por empresa; las
notas se resuelven siempre por join contra `contacts`. Sin hallazgos.

## Pruebas

| Metrica | Antes (`ddc5de3`) | Ahora (`3417c32`) |
| --- | --- | --- |
| Ficheros de prueba | 10 | 12 |
| Casos | 62 | 149 |
| Typecheck | limpio | limpio |
| Build | limpio | limpio |
| `npm audit` | 0 vulnerabilidades | 0 vulnerabilidades |

Reproducir:

```bash
cd integration-api
npm ci
npm test
npm run typecheck
npm run build
```

## Rollback probado

El rollback **se ejecuto de verdad**, no solo se documento: se volvio a la imagen
de `ddc5de3`, se comprobo `health 200`, `ready 200` y el CRM en `200`, y despues
se avanzo de nuevo a `3417c32`. La imagen anterior queda conservada como
`zinto-integration-api:rollback-ddc5de3`.

```bash
cd integration-api
docker tag zinto-integration-api:rollback-ddc5de3 zinto-integration-api:0.1.0
docker compose -f deploy/docker-compose.preview.yml up -d --force-recreate
```

Esto no toca Nginx, ni la base de datos, ni el CRM. Para retirar el preview por
completo, ver `integration-api/deploy/README.md`.

## Lo que falta (la API no esta terminada)

Bloqueantes antes de habilitar escrituras:

1. Cerrar el riesgo residual de media descrito arriba.
2. Fase B.4/B.5: limites de peticiones por clave/empresa/IP con `Retry-After`, y
   limites de cuerpo diferenciados.
3. Fase B.6: revision de redaction de logs incluyendo query strings, cuerpos y
   errores del proveedor.
4. Fase C: staging con backup restaurable, aplicar y revertir la migracion alli,
   y `EXPLAIN (ANALYZE, BUFFERS)` con volumen representativo.
5. Pendiente 4 del runbook: auditar el adaptador legacy, porque algunas rutas
   antiguas atribuyen los envios al usuario 1. Hay que corregir la autoria antes
   de abrir escrituras publicas.
6. Fase D: pipelines, etapas, deals y tareas con aislamiento estricto y sus
   eventos reales; creacion/seleccion explicita de conversacion; filtros
   `updated_since`.
7. Fase E: E2E bidireccional real en canales de Espana y Chile con numeros de
   prueba autorizados por el propietario.
8. Las cuatro auditorias independientes (seguridad, contrato, datos, operacion).
9. Retencion y limpieza de idempotencia y outbox, metricas y alertas.

## Condiciones de parada vigentes

Sin cambios respecto al runbook original. Se anade una: **si alguien habilita
`send-media` hacia terceros antes de cerrar el riesgo residual, hay que revertir
a read-only de inmediato.**
