# Diario de decisiones: defensa SSRF y aislamiento multiempresa

Fecha: 13 de agosto de 2026
Rama: `codex/integration-api-v1`
Commit base al empezar: `ddc5de3`
Modo del preview durante todo el trabajo: `READ_ONLY_MODE=true`, worker apagado,
migracion `001_integration_api.sql` NO aplicada.

## Estado verificado antes de tocar codigo

No se acepto el relevo como cierto sin comprobarlo. Lo comprobado:

- Worktree limpio y `HEAD` igual a `origin/codex/integration-api-v1` (`ddc5de3`).
- Suite base: 62 pruebas verdes, typecheck y build limpios, `npm audit` sin
  vulnerabilidades.
- `GET https://crm.zinto.app/_integration-api/health` -> `200`.
- `GET .../ready` -> `200` con la dependencia de base de datos lista.
- `GET .../api/v1/me` sin clave -> `401 missing_api_key`.
- `POST .../api/v1/contacts` -> `403` devuelto por Nginx.
- `GET https://crm.zinto.app/inbox` -> `200`; el CRM original sigue operativo.
- Contenedores en marcha: `zinto-integration-api-preview` (127.0.0.1:3100),
  `powerchat-app-bcousinoprop`, `powerchat-postgres-bcousinoprop`.

Discrepancia encontrada con el relevo: el paso A6 pide comprobar que VPS y
GitHub ejecutan el mismo commit "mediante un archivo de release o label de
imagen". La imagen `zinto-integration-api:0.1.0` no tenia ninguno de los dos, asi
que esa verificacion no era posible. Se corrige en esta entrega.

## Hallazgos SSRF (pendiente prioritario 2)

### 1. Registro de webhooks no resolvia DNS — alto

`assertSafeWebhookUrl` solo exigia HTTPS, ausencia de credenciales, hostname
distinto de `localhost` y que no fuera una IP literal. Un nombre publico que
apunte a `127.0.0.1`, `10.x` o `169.254.169.254` se aceptaba sin mas. El relevo
ya lo sospechaba; queda confirmado y corregido.

### 2. El dispatcher usaba `fetch` global — alto

`dispatchBatch` entregaba con `fetch`, que sigue redirecciones por defecto y no
comprueba la direccion de destino. Un endpoint registrado como publico podia
repuntarse despues a una direccion interna, o responder `302` hacia ella.

### 3. Clasificacion de direcciones incompleta — medio

La comprobacion de media no cubria CGNAT `100.64.0.0/10` (exigido de forma
explicita por el relevo), ni `192.0.0.0/24`, `198.18.0.0/15` ni los rangos
TEST-NET. En IPv6 el tratamiento de direcciones IPv4 mapeadas era por prefijo de
texto y solo contemplaba `::ffff:127.`, `::ffff:10.` y `::ffff:192.168.`, de modo
que `::ffff:172.16.0.1`, `::ffff:169.254.169.254`, `::ffff:100.64.0.1` y la forma
hexadecimal `::ffff:7f00:1` pasaban. Tampoco se cubrian NAT64 `64:ff9b::/96` ni
6to4 `2002::/16`.

## Decisiones tomadas

1. **Un solo componente compartido.** `src/net/ip-rules.ts` clasifica
   direcciones, `src/net/destination.ts` valida destinos y `src/net/safe-fetch.ts`
   conecta. Media, registro de webhooks y entrega usan el mismo criterio; no hay
   dos definiciones de "direccion segura" que puedan divergir.

2. **IPv6 se parsea a bytes, no a texto.** Toda forma que pueda transportar una
   IPv4 incrustada (mapeada, compatible, NAT64) se desenvuelve y se reevalua con
   las reglas IPv4. 6to4 se bloquea entero por simplicidad y seguridad.

3. **Lo que no se puede clasificar se bloquea.** `isBlockedIpAddress` devuelve
   `true` ante entrada no parseable. Una direccion que no entendemos no es una
   direccion en la que confiamos.

4. **Se exige que *todas* las direcciones resueltas sean publicas**, no solo la
   elegida. Un nombre que responde con una publica y una privada se rechaza
   entero; asi se elimina la carrera en la que el runtime escoge la privada.

5. **Pinning real en el socket.** `safe-fetch` pasa un `lookup` propio a
   `node:http`/`node:https`. La direccion que se valida es exactamente la que
   recibe el socket, que es lo que cierra la ventana de rebinding que deja un
   diseno "validar y luego hacer fetch". Las IP literales se validan aparte
   porque Node no llama a `lookup` cuando el host ya es una IP.

6. **Redirecciones prohibidas por defecto** (`maxRedirects: 0`). Un receptor de
   webhooks no tiene motivo para rebotarnos. Cuando se permiten, cada salto se
   resuelve y se autoriza de nuevo: ningun salto hereda el veredicto del
   anterior. Tambien se limita el tamano de respuesta a 1 MiB.

7. **Se mantiene el codigo de error publico** (`unsafe_media_url`,
   `unsafe_webhook_url`) para no romper el contrato OpenAPI ya publicado; el
   motivo interno no se filtra al cliente.

## Riesgo residual declarado

La URL de media se entrega al motor legacy, que hace la descarga real. Podemos
autorizar el destino, pero no fijamos el socket que abre el motor: entre nuestra
validacion y su descarga sigue existiendo una ventana de DNS rebinding. Cerrarla
exige que el motor legacy use un cliente seguro o que la media pase por
almacenamiento controlado. **No debe habilitarse el envio de media a terceros
sin resolver esto.** Queda como bloqueante para la Fase F.

## Aislamiento multiempresa (Fase B.7)

Auditoria sistematica en `test/tenant-isolation.test.ts`: se siembran contacto,
nota, canal, conversacion y webhook de la empresa 77 y se ataca cada ruta con una
clave de la empresa 12.

Resultado: sin violaciones. Las nueve rutas con ID ajeno devuelven `404`, las
listas salen vacias, no se filtra ningun dato del titular, ningun repositorio
registra escritura y un contacto creado queda ligado a la empresa de la clave y
nunca a una suministrada por el cliente.

Revision del SQL real: todas las consultas de `resources/core.ts` y
`resources/contact-mutations.ts` filtran por `company_id`; `listMessages`
comprueba ademas la propiedad de la conversacion y vuelve a unir por empresa; las
notas se resuelven siempre por join contra `contacts`. Sin hallazgos.

## Trazabilidad de artefacto (paso A6)

`Dockerfile` acepta `ARG GIT_COMMIT`, lo publica como
`org.opencontainers.image.revision` y lo escribe en `/app/RELEASE`. El compose de
preview lo pasa desde el entorno. Verificacion en el VPS:

```bash
docker inspect zinto-integration-api-preview \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

Ese valor debe coincidir con `git rev-parse HEAD` de la rama desplegada.
Deliberadamente no se expone el commit por HTTP: la verificacion es de
operacion, no una superficie publica nueva.

## Lo que esta entrega NO hace

- No aplica la migracion.
- No habilita escrituras ni el worker.
- No toca Nginx ni el CRM compilado.
- No abre ninguna sesion Baileys.
- No cubre pipelines, etapas, deals ni tareas (Fase D).
- No incluye rate limits ni metricas (pendiente 5).
- No incluye E2E con numeros reales (Fase E): requiere numeros de prueba
  autorizados por el propietario.
