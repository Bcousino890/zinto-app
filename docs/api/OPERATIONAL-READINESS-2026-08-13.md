# Auditoría operativa (Bloque 6, punto 4) — Docker, Nginx, rollout/rollback

Fecha: 13 de agosto de 2026. Verificación **de solo lectura** contra el VPS
real (curl al preview público, `docker inspect`, lectura del snippet de
Nginx realmente cargado por aaPanel) — sin aplicar, modificar ni recargar
nada. Complementa `docs/api/MEDIA-PROXY-2026-08-13.md` (que ya listaba estos
pendientes) con evidencia fresca en vez de solo lo documentado en el momento
del relevo.

---

## 1. Estado en vivo verificado ahora mismo

| Comprobación | Resultado | Lectura |
|---|---:|---|
| `GET https://crm.zinto.app/_integration-api/health` | `200` | OK |
| `GET https://crm.zinto.app/_integration-api/ready` | `200` | OK |
| `GET https://crm.zinto.app/inbox` (CRM intacto) | `200` | OK |
| `POST https://crm.zinto.app/_integration-api/api/v1/contacts` | `403` | Bloqueado por Nginx antes de llegar a la app — ver 2.1 |
| `GET https://crm.zinto.app/_integration-api/internal/media/test` | `404` | **No es el bloqueo de Nginx** — ver 2.2, es la ausencia de la ruta en la app porque el proxy de media sigue desactivado |
| Revisión desplegada (`docker inspect ... image.revision`) | `3417c32` | Sin cambios desde el relevo: nada se ha desplegado en este VPS desde entonces, como se espera antes del único push |

## 2. Puertas de escritura — verificadas por separado, no asumidas

### 2.1 Puerta Nginx (bloqueo de métodos) — **aplicada y verificada en vivo**

El snippet realmente cargado por aaPanel
(`/www/server/panel/vhost/nginx/extension/crm.zinto.app/zinto-integration-api-preview.conf`,
leído directamente del disco, no de este repo) contiene:

```nginx
location ^~ /_integration-api/ {
  limit_except GET HEAD OPTIONS { deny all; }
  proxy_pass http://127.0.0.1:3100/;
  ...
}
```

El `403` real de arriba confirma que está activa: cualquier método distinto
de `GET`/`HEAD`/`OPTIONS` se rechaza en el borde, antes de llegar siquiera a
`READ_ONLY_MODE` dentro de la app. Dos capas independientes bloquean
escritura hoy (Nginx + `READ_ONLY_MODE=true` en el propio proceso), lo cual
es la defensa en profundidad correcta.

### 2.2 Puerta del prefijo interno de media — **NO aplicada, confirmado por lectura directa**

El mismo snippet real **no contiene** el bloque
`location ^~ /_integration-api/internal/ { deny all; }` que sí existe en
`integration-api/deploy/nginx-integration-api-preview.conf` de este repo.
Confirma con evidencia directa (no solo con lo ya documentado) lo que
`MEDIA-PROXY-2026-08-13.md` marcaba como pendiente #2: la regla está escrita
pero nunca se aplicó al vhost real.

El `404` obtenido al pedir esa ruta **no es prueba de que la regla esté
activa** — es un falso indicio. La ruta `/internal/media/:id` solo se
registra en la app cuando `mediaStore` existe
(`src/app.ts`, `if (options.mediaStore !== undefined) registerMediaRoutes(...)`),
y `mediaStore` solo se crea cuando `MEDIA_PROXY_ENABLED=true`
(`src/server.ts`). Como el proxy sigue desactivado, la ruta ni siquiera
existe en la app, y Nginx reenvía la petición sin más — el `404` es el
"ruta no encontrada" propio de Fastify, no un `403` de Nginx. **El día que se
active `MEDIA_PROXY_ENABLED`, este prefijo quedará expuesto sin protección de
borde hasta que alguien aplique manualmente la regla que falta.** No se toca
aquí porque modificar el vhost de Nginx en producción es una acción que
requiere pasos explícitos y deliberados (ya descritos en
`MEDIA-PROXY-2026-08-13.md`), no algo para aplicar de forma incidental
durante una auditoría de solo lectura.

## 3. Docker — hardening confirmado por lectura de `docker-compose.preview.yml`

- `read_only: true` con `tmpfs` de 32 MB en `/tmp` (`noexec,nosuid,nodev`):
  el contenedor no puede escribir en su propio filesystem — coherente con
  por qué el proxy de media necesita un volumen dedicado nuevo antes de
  activarse (pendiente #1 de `MEDIA-PROXY-2026-08-13.md`, sigue sin resolver,
  no se toca aquí).
- `cap_drop: [ALL]` + `security_opt: [no-new-privileges:true]`: superficie
  mínima de capacidades Linux.
- `healthcheck` cada 30 s contra `/ready` con `start_period: 15s` — permite a
  Docker/orquestación detectar un contenedor que arrancó pero no puede
  conectar a Postgres.
- `GIT_COMMIT` se pasa como build arg y se estampa como label OCI
  (`org.opencontainers.image.revision`), lo que permitió la verificación de
  la tabla 1 sin adivinar qué código corre realmente.
- Solo se une a `powerchat-shared-network` (necesaria para Postgres) y
  publica el puerto únicamente en `127.0.0.1:3100` — nunca expuesto
  directamente a la red pública, solo a través de Nginx.
- `READ_ONLY_MODE: "true"` y `WEBHOOK_WORKER_ENABLED: "false"` están fijados
  como variables de entorno en el propio `docker-compose.preview.yml`, no
  solo en `.env` — un despliegue que reutilice este archivo tal cual no
  puede activarlas por accidente sin editar el compose explícitamente.

## 4. Rollback — procedimiento ya documentado, verificado como coherente

`integration-api/deploy/README.md` documenta un rollback por imagen
etiquetada (`docker tag ... zinto-integration-api:rollback-<fecha>` antes de
cada `up -d --build`, y `docker tag` + `up -d --force-recreate` para volver
atrás) que no requiere tocar Nginx ni el CRM, y aclara explícitamente que
**no hace falta rollback de base de datos** porque el preview nunca aplica la
migración. Es coherente con todo lo verificado en este bloque: no hay estado
persistente propio del contenedor (filesystem de solo lectura), así que
revertir la imagen es suficiente.

## 5. Convivencia con el CRM compilado

Confirmado de nuevo en este pase: contenedores separados
(`powerchat-app-bcousinoprop` en el puerto 9000, `zinto-integration-api-preview`
en el 3100), ambos detrás del mismo Nginx mediante rutas distintas
(`/inbox` vs `/_integration-api/`), compartiendo únicamente la red Docker
para llegar al mismo Postgres. Ninguna de las tareas de este bloque tocó el
bundle compilado del CRM (`dist/`) ni el contenedor
`powerchat-app-bcousinoprop`, y `curl https://crm.zinto.app/inbox` sigue en
`200` al terminar.

## 6. Lo que queda pendiente, sin tocar, para cuando se decida activar escrituras/media

Nada nuevo respecto a lo ya documentado — esta sección solo consolida en un
solo lugar lo que sigue abierto, con su documento de origen:

1. Aplicar la regla de Nginx que falta (`internal/` deny) — confirmada
   ausente en el punto 2.2 de este documento, procedimiento en
   `MEDIA-PROXY-2026-08-13.md` punto 2.
2. Volumen escribible para `MEDIA_STORAGE_DIR` — `MEDIA-PROXY-2026-08-13.md`
   punto 1.
3. Confirmar alcance de red del motor legacy al host interno —
   `MEDIA-PROXY-2026-08-13.md` punto 3.
4. Ajustar `MEDIA_MAX_BYTES` a límites reales del proveedor —
   `MEDIA-PROXY-2026-08-13.md` punto 4.
5. E2E autorizado — bloqueado hasta recibir los números de prueba del
   propietario (España, Chile) y la empresa piloto.
6. Aplicar `002_performance_indexes.sql` en producción — preparado y
   verificado en staging, decisión y ejecución del propietario
   (`STAGING-REPORT-2026-08-13.md` sección 6.4).
7. Aplicar `001_integration_api.sql` en producción — decisión del
   propietario, con los dos hallazgos de trigger ya corregidos
   (`STAGING-REPORT-2026-08-13.md`).

Ninguno de estos siete puntos se tocó durante este bloque de trabajo: todos
requieren una acción deliberada en producción (Nginx, volumen, migración) o
datos que solo el propietario puede proveer.
