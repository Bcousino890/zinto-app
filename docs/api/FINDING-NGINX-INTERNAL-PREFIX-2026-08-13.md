# Hallazgo: la regla de Nginx que debe bloquear `/_integration-api/internal/` no está aplicada

> **RESUELTO, misma fecha, tarde.** Corregido con autorización explícita del
> propietario: el bloque `location ^~ /_integration-api/internal/ { deny
> all; }` ya está en el vhost real, verificado en vivo con `curl` (`404` →
> `403`). Detalle de la ejecución: `docs/api/E2E-PILOT-RESULT-2026-08-13.md`,
> paso A1. El resto de este documento describe el hallazgo original y la
> corrección exacta que se aplicó — se deja intacto como referencia de lo que
> se hizo y por qué.

Fecha del hallazgo: 13 de agosto de 2026. Severidad: **media, sin explotación
posible hoy** (ver "Por qué no es explotable todavía" abajo). Bloqueaba
activar tanto el proxy de media (`MEDIA_PROXY_ENABLED`) como las métricas
(`METRICS_ENABLED`) hasta corregirse — ya corregido. Este documento es la
referencia única y definitiva de este hallazgo — los demás documentos que lo
mencionan (`docs/api/MEDIA-PROXY-2026-08-13.md`,
`docs/api/OPERATIONAL-READINESS-2026-08-13.md`,
`docs/api/METRICS-2026-08-13.md`) enlazan aquí en vez de repetir el detalle.

---

## Qué se verificó y cómo

No es una suposición ni algo solo documentado: se leyó **el archivo real que
aaPanel tiene cargado** para `crm.zinto.app`, en el propio VPS, en el momento
del hallazgo:

```bash
cat /www/server/panel/vhost/nginx/extension/crm.zinto.app/zinto-integration-api-preview.conf
```

Contenido completo, verificado por lectura directa (no se modificó nada):

```nginx
# Insert this location inside the existing HTTPS server for crm.zinto.app.
location ^~ /_integration-api/ {
  limit_except GET HEAD OPTIONS {
    deny all;
  }

  proxy_pass http://127.0.0.1:3100/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_connect_timeout 5s;
  proxy_read_timeout 30s;
}
```

Comparado con el archivo versionado en el repo,
`integration-api/deploy/nginx-integration-api-preview.conf`, que sí incluye
el bloque de denegación:

```nginx
# Insert these locations inside the existing HTTPS server for crm.zinto.app.

# Proxied media is fetched by the delivery engine over the internal Docker
# network and is protected only by an unguessable identifier, so the prefix must
# never be reachable from the public internet.
location ^~ /_integration-api/internal/ {
  deny all;
}

location /_integration-api/ {
  limit_except GET HEAD OPTIONS {
    deny all;
  }
  proxy_pass http://127.0.0.1:3100/;
  ...
}
```

**El bloque `location ^~ /_integration-api/internal/ { deny all; }` nunca se
aplicó al vhost real.** El archivo del repo existe desde que se implementó el
proxy de media; el archivo real en `/www/server/...` no se ha tocado desde
entonces.

## Confirmación empírica (no solo lectura de archivo)

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://crm.zinto.app/_integration-api/internal/media/test
# -> 404
```

**Este `404` engaña si se lee como "está bloqueado".** No lo está: es Fastify
devolviendo "ruta no encontrada" porque `MEDIA_PROXY_ENABLED=false` hoy, así
que la ruta `/internal/media/:id` ni siquiera está registrada en la app
(`src/app.ts`: `if (options.mediaStore !== undefined) registerMediaRoutes(...)`,
y `mediaStore` solo existe si `MEDIA_PROXY_ENABLED=true`). La petición
**atraviesa Nginx sin que nada la detenga** y llega a la app, que responde
404 solo porque no tiene nada que servir ahí todavía. Lo mismo aplica a
`/_integration-api/internal/metrics` con `METRICS_ENABLED=false`.

## Por qué no es explotable todavía

Ninguna de las dos rutas que vivirían bajo `internal/` existe hoy en el
proceso en ejecución, porque ambas features (`MEDIA_PROXY_ENABLED`,
`METRICS_ENABLED`) están desactivadas por defecto. No hay nada que un
atacante pueda alcanzar hoy a través de esta ausencia de regla. El riesgo es
**para el día que cualquiera de las dos se active**: en ese momento, hasta
que se aplique esta regla, `/internal/media/:id` (que sirve bytes de media de
clientes protegidos solo por un identificador de 256 bits impredecible, no
por autenticación) y `/internal/metrics` (que expone latencia por ruta, tasa
de error y estado del outbox/webhooks) quedarían alcanzables desde fuera de
la red Docker.

## La corrección exacta

**Cambio mínimo, de bajo riesgo**: no hace falta reemplazar todo el archivo
del vhost, solo **añadir** el bloque de denegación. El orden de los bloques
en el archivo no importa para el resultado — Nginx elige el `location` con el
prefijo que más caracteres coincida antes de mirar el modificador `^~`, así
que `/_integration-api/internal/` (más largo) siempre gana sobre
`/_integration-api/` (más corto) para cualquier URL bajo `internal/`,
independientemente del orden en que aparezcan en el archivo o de si el
bloque general conserva su propio `^~`.

1. Editar `/www/server/panel/vhost/nginx/extension/crm.zinto.app/zinto-integration-api-preview.conf`
   y añadir, en cualquier punto del archivo, antes o después del bloque
   existente:

   ```nginx
   location ^~ /_integration-api/internal/ {
     deny all;
   }
   ```

2. Validar la sintaxis antes de recargar:

   ```bash
   /www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf
   ```

3. Recargar sin caída de servicio:

   ```bash
   kill -HUP $(pgrep -o nginx)
   ```

4. Verificar que quedó activa:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://crm.zinto.app/_integration-api/internal/media/test
   # debe pasar de 404 a 403
   ```

   Un `403` aquí confirma que Nginx corta la petición antes de que llegue a
   la app — la comprobación correcta, distinta del `404` actual que solo
   refleja que la ruta no está registrada.

5. Confirmar que el resto del servicio sigue intacto:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://crm.zinto.app/_integration-api/health   # 200
   curl -s -o /dev/null -w "%{http_code}\n" https://crm.zinto.app/inbox                       # 200
   ```

## Cuándo debe aplicarse

**Antes** de poner `MEDIA_PROXY_ENABLED=true` o `METRICS_ENABLED=true` en
producción por primera vez — es uno de los pendientes operativos ya listados
en `docs/api/MEDIA-PROXY-2026-08-13.md` (punto 2) y en
`docs/api/OPERATIONAL-READINESS-2026-08-13.md` (punto 6.1). Puede aplicarse
en cualquier momento antes de eso sin ningún efecto observable, porque hoy no
bloquea nada que hoy exista.

## Verificación futura recomendada

Añadir esta comprobación (`curl` al prefijo `internal/`, esperar `403`) a
cualquier checklist de despliegue o smoke test que se use en el futuro, junto
a las comprobaciones de `/health`/`/ready` que ya existen en
`integration-api/deploy/README.md`, para que quede verificado en cada
despliegue y no vuelva a pasar desapercibido.
