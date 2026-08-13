# Cierre del riesgo residual de media

Fecha: 13 de agosto de 2026
Estado: **implementado y probado, DESACTIVADO por defecto**
`send-media` sigue cerrado a terceros hasta que se active deliberadamente.

## El problema que se cierra

La API validaba `media_url` y se la entregaba al motor legacy
(`powerchat-app-bcousinoprop`), que hacía la descarga real con su propio cliente
HTTP. Entre nuestra validación y su descarga había una ventana de DNS rebinding:
un nombre con TTL bajo puede responder una dirección pública cuando validamos y
una dirección interna cuando el motor descarga.

Nuestro pinning de socket no lo resolvía, porque **la descarga nunca era
nuestra**. Esa es la raíz: no se puede fijar una conexión que abre otro proceso.

## La solución

La descarga pasa a ser nuestra. El motor deja de ver la URL del partner.

```text
Partner  ->  POST /api/v1/messages/send-media { media_url: https://cdn.partner.example/a.png }
                 |
                 | 1. assertSafeMediaUrl: destino autorizado
                 | 2. safe-fetch: descarga con socket fijado a la direccion validada
                 | 3. limite de tamano y coherencia de content-type
                 | 4. almacenamiento controlado, nombre aleatorio de 256 bits
                 v
             http://zinto-integration-api-preview:3100/internal/media/<id>
                 |
                 | el motor solo recibe esta URL
                 v
             powerchat-app-bcousinoprop:9000
```

### Decisiones y su porqué

1. **La descarga usa `safe-fetch`**, no `fetch`. La dirección que se autoriza es
   la que recibe el socket, y las redirecciones están prohibidas por defecto.
2. **El nombre almacenado es aleatorio**, nunca derivado de la URL, del nombre de
   fichero del partner ni del contenido. Dos subidas idénticas producen
   identificadores distintos. El identificador es lo único que protege el objeto,
   así que no debe ser adivinable ni reproducible.
3. **El identificador se valida contra `^[a-f0-9]{64}$` antes de tocar el
   sistema de ficheros.** Un intento de traversal se rechaza como nombre
   inválido, no se resuelve como ruta.
4. **`content-type` debe ser coherente con el `media_type` declarado.** Para
   documentos se prohíben explícitamente HTML y JavaScript: entregar un payload
   activo a un destinatario sería peor que entregar un fichero equivocado.
5. **El tamaño se comprueba dos veces**: por `content-length` declarado y por
   bytes realmente recibidos, porque la cabecera es entrada no confiable. El
   límite aplicado en ambas comprobaciones se selecciona según `media_type`
   (ver más abajo) - no es un único valor compartido entre imagen, vídeo,
   audio y documento.
6. **La ruta de servicio no lleva autenticación** porque el motor la descarga sin
   arrastrar las credenciales del partner. Por eso el identificador es la
   capacidad, y el prefijo se deniega en el proxy público.
7. **Arranque en fallo cerrado**: si `MEDIA_PROXY_ENABLED=true` sin
   `MEDIA_INTERNAL_BASE_URL`, el servicio no arranca. Sin esa comprobación la
   configuración incompleta degradaría en silencio a reenviar la URL del partner,
   que es exactamente el fallo que estamos cerrando.
8. **Retención**: limpieza periódica según `MEDIA_RETENTION_MINUTES` (60 por
   defecto). La media descargada es dato de cliente y no debe acumularse.

## Configuración

| Variable | Defecto | Nota |
| --- | --- | --- |
| `MEDIA_PROXY_ENABLED` | `false` | Mientras sea `false`, el riesgo sigue abierto |
| `MEDIA_INTERNAL_BASE_URL` | — | Obligatoria si está activado |
| `MEDIA_STORAGE_DIR` | `/var/lib/zinto-media` | Debe ser escribible |
| `MEDIA_MAX_BYTES_IMAGE` | `5242880` (5 MB) | |
| `MEDIA_MAX_BYTES_VIDEO` | `16777216` (16 MB) | |
| `MEDIA_MAX_BYTES_AUDIO` | `16777216` (16 MB) | |
| `MEDIA_MAX_BYTES_DOCUMENT` | `104857600` (100 MB) | |
| `MEDIA_RETENTION_MINUTES` | `60` | |

Los cuatro límites de tamaño reemplazan al antiguo `MEDIA_MAX_BYTES` único, y
reflejan los límites reales de WhatsApp Business API por tipo de media
(imagen 5 MB, video 16 MB, audio 16 MB, documento 100 MB) - el motor legacy
los sirve directamente en los canales `whatsapp_official`/`whatsapp_meta`, y
`whatsapp_unofficial`/Baileys los sigue de cerca con los mismos matices. Un
único límite compartido obligaba a elegir entre rechazar documentos válidos
de más de 16 MB o aceptar imágenes de hasta 100 MB si se subía el límite
global para acomodar documentos; ninguna de las dos era correcta.

Cada variable se construye con el mismo esquema Zod que ya usaba
`MEDIA_MAX_BYTES` (`min(1024).max(104_857_600)`), así que el propio límite
superior de cada variable (100 MiB) actúa como techo de seguridad absoluto
por tipo - no existe una variable de respaldo separada, porque una quinta
variable "global" solo podría quedar desincronizada con estas cuatro sin
aportar una protección que el `.max()` de cada una no dé ya. El límite
seleccionado para una descarga se resuelve a partir de `media_type` en
`src/media/proxy.ts` (`DownloadingMediaProxy.prepare`) antes de invocar
`fetchRemoteMedia` - la política que llega a `src/media/fetch.ts` ya trae el
`maxBytes` correcto para esa descarga en concreto.

## Pruebas

`test/media-proxy.test.ts` cubre, entre otros:

- devuelve bytes y tipo de una imagen permitida;
- rechaza content-type que contradice el tipo declarado;
- rechaza payload mayor que el límite, y también cuando solo lo declara la
  cabecera `content-length`;
- rechaza respuesta no 2xx del origen;
- distingue destino inseguro de destino inalcanzable;
- acepta los tipos correctos para imagen, vídeo, audio y documento;
- rechaza un documento que dice ser HTML;
- almacena bajo identificador impredecible y lo sirve de vuelta;
- dos subidas idénticas no comparten identificador;
- rechaza identificadores que intentan escapar del directorio;
- purga por ventana de retención, y conserva dentro de la ventana;
- **prueba de extremo a extremo: el cliente de entrega recibe una URL interna,
  nunca la del partner, y los bytes se sirven correctamente**;
- los errores son `ApiError` para no romper el contrato público;
- **límites por tipo de media**: una imagen de 6 MB se rechaza mientras el
  mismo payload de 6 MB se acepta como documento; un documento de 90 MB se
  acepta bajo el default de 100 MB; un video de 17 MB se rechaza aunque esté
  muy por debajo del límite de documento; la doble comprobación
  (`content-length` declarado y bytes reales) sigue funcionando, aplicando en
  cada caso el límite del tipo correspondiente.

Más casos en `test/config.test.ts` (defaults y límites min/max de las cuatro
variables `MEDIA_MAX_BYTES_*`, además del fallo cerrado de configuración) y en
`test/deployment.test.ts` (denegación del prefijo en Nginx).

## Lo que FALTA antes de activarlo

Esto está implementado y probado, pero **no basta con poner la variable a true**:

1. **Volumen escribible.** El contenedor corre con `read_only: true` y solo tiene
   un `tmpfs` de 32 MB en `/tmp`. Hay que añadir un volumen dedicado para
   `MEDIA_STORAGE_DIR`, dimensionado para el pico de media y la ventana de
   retención.
2. **Aplicar la regla de Nginx.** El snippet
   `deploy/nginx-integration-api-preview.conf` ya deniega
   `/_integration-api/internal/`, pero **todavía no está aplicado en el vhost**.
   Aplicarlo con `/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf`
   y `kill -HUP $(pgrep -o nginx)`. Verificar después que
   `https://crm.zinto.app/_integration-api/internal/media/<id>` devuelve 403.
3. **Confirmar que el motor legacy alcanza `MEDIA_INTERNAL_BASE_URL`** por la red
   Docker compartida, y que acepta una URL de ese host.
4. ~~**Comprobar los límites reales del proveedor** (WhatsApp) para cada tipo, y
   ajustar `MEDIA_MAX_BYTES` en consecuencia.~~ **Hecho.** El límite único se
   reemplazó por `MEDIA_MAX_BYTES_IMAGE`/`_VIDEO`/`_AUDIO`/`_DOCUMENT` (ver
   "Configuración" arriba) con los valores reales de WhatsApp Business API por
   tipo. Sigue pendiente, si se descubre evidencia concreta, ajustar esos
   defaults para un canal específico que difiera de la tabla documentada aquí
   (por ejemplo, un límite distinto observado en `whatsapp_unofficial`/Baileys
   en producción) - por ahora no hay evidencia de eso en el código y no se ha
   inventado ningún número.
5. **E2E autorizado** con números de prueba antes de abrirlo a un partner.

Hasta completar los cinco puntos, `send-media` no debe habilitarse para
terceros, y el riesgo residual descrito en el handoff de esta sesión sigue
vigente en la práctica aunque el código que lo cierra ya exista.
