# Checklist final SmartBC: company_id=3

Este checklist es una puerta de despliegue para SmartBC. El estado actual es
**NO-GO para escrituras y webhooks**: el preview queda solo lectura hasta que
todos los bloqueantes y verificaciones esten cerrados con evidencia.

## Bloqueantes antes de abrir trafico SmartBC

- [ ] Corregir y probar la allowlist de API keys: con `TRUST_PROXY=true`, el
  proxy debe reemplazar, no concatenar, `X-Forwarded-For`; el servicio solo debe
  confiar en el proxy local conocido. Probar que una IP no allowlisted no puede
  forjar una IP allowlisted.
- [ ] Corregir y probar SSRF para URLs de webhook: resolver A y AAAA, rechazar
  loopback, RFC1918, link-local, CGNAT, multicast y direcciones no enrutable;
  evitar DNS rebinding y validar cada redireccion antes de conectar.
- [ ] Corregir la discrepancia contrato/runtime que hoy acepta elementos
  duplicados en `event_types` aunque OpenAPI declara `uniqueItems: true`.
- [ ] Confirmar que no hay criticos ni altos abiertos, incluida una revision
  independiente de aislamiento multi-tenant, HMAC, idempotencia y proxy.

## Contrato y acceso de company_id=3

- [ ] Confirmar la raiz de servicio
  `https://crm.zinto.app/_integration-api` y la base REST
  `https://crm.zinto.app/_integration-api/api/v1`; no duplicar `/api/v1`.
- [ ] Crear una clave nueva exclusivamente para SmartBC, asociada a
  `company_id=3`, con vencimiento y las IPs de salida de SmartBC solo despues de
  cerrar el bloqueo de proxy/allowlist.
- [ ] Ejecutar `GET /api/v1/me` y abortar si `data.company.id` no es `"3"`.
- [ ] Empezar con scopes minimos de lectura:
  `channels:read`, `contacts:read`, `conversations:read`, `messages:read`.
- [ ] Anadir `contacts:write`, `notes:write`, `tags:write`, `messages:send` y
  `webhooks:manage` solo cuando cada flujo E2E correspondiente este aprobado.
- [ ] No conceder `*`; nunca enviar `company_id` en el cuerpo o query string.
- [ ] Validar OpenAPI frente a las rutas reales, metodos, scopes y errores; las
  escrituras deben documentar su respuesta `503 read_only_mode` mientras este
  activo el freno de seguridad.

## Base de datos y migracion

- [ ] Identificar el PostgreSQL correcto y verificar esquema, columnas, FKs y
  extensiones requeridas por `migrations/001_integration_api.sql` en una copia
  restaurada de produccion.
- [ ] Crear backup cifrado, registrar timestamp, checksum y responsable; probar
  una restauracion completa antes de la ventana.
- [ ] Aplicar la migracion primero en staging y comprobar triggers de contactos,
  notas, conversaciones, mensajes y canales: empresa correcta, un evento por
  cambio y payload sin secretos.
- [ ] Medir bloqueo y rendimiento de los triggers con volumen representativo y
  revisar crecimiento de `integration_api_outbox` y deliveries.
- [ ] Aplicar la migracion en produccion solo en una ventana aprobada y guardar
  el log de salida. No hay migracion down automatica: el rollback de datos es
  restaurar el backup validado.

## Modos y worker

- [ ] Mantener `READ_ONLY_MODE=true`, `WEBHOOK_WORKER_ENABLED=false` y Nginx
  GET-only durante verificacion de conectividad y lecturas.
- [ ] Para el piloto, habilitar escrituras de forma coordinada: permitir los
  metodos necesarios en Nginx y cambiar `READ_ONLY_MODE=false`; comprobar que
  una mutacion autenticada deja de responder `503 read_only_mode` solo para la
  clave de company_id=3.
- [ ] Mantener `WEBHOOK_WORKER_ENABLED=false` hasta tener endpoint SmartBC HTTPS,
  secreto custodiado y migracion aplicada.
- [ ] Activar un unico worker (`WEBHOOK_WORKER_ENABLED=true`) y comprobar lease,
  reintentos, backoff, dead letters y apagado limpio. Alertar por outbox pendiente,
  deliveries `dead`, errores de worker, latencia y duplicados.

## E2E autorizado para SmartBC

- [ ] Usar solo contactos, canales y numeros de prueba autorizados de
  company_id=3; registrar IDs y ventana de prueba sin exponer claves o secretos.
- [ ] Verificar `GET /channels`, paginacion de contactos/conversaciones/mensajes
  y que ningun ID de otra empresa se pueda leer o mutar.
- [ ] Crear contacto y nota con una `Idempotency-Key`; repetir exactamente la
  solicitud y confirmar mismo resultado e `Idempotent-Replayed: true`. Reutilizar
  la clave con cuerpo distinto y confirmar `409 idempotency_conflict`.
- [ ] Enviar texto por un canal activo y compatible; confirmar resultado en Zinto
  y proveedor. Ante `504 delivery_timeout`, no crear otra clave ni reenviar hasta
  reconciliar por historial o webhook.
- [ ] Registrar webhook HTTPS, guardar el secreto una sola vez y comprobar HMAC
  sobre `timestamp + "." + raw_http_body`, timestamp maximo de cinco minutos,
  igualdad de `X-Zinto-Event-Id` y `body.id`, y deduplicacion persistente por ID.
- [ ] Simular `2xx`, timeout, `5xx`, reintento, evento duplicado y orden inverso;
  confirmar que SmartBC responde `2xx` solo tras persistir el evento.
- [ ] Confirmar que un mensaje entrante llega como `message.created` con
  `data.direction="incoming"`; no esperar `message.received`.

## Go/rollback

- [ ] Autorizar la ampliacion solo con evidencia de todas las casillas, owner de
  guardia, umbrales de alerta y commit/digest de imagen identificados.
- [ ] Para parar el piloto: volver Nginx a GET-only, poner
  `READ_ONLY_MODE=true`, poner `WEBHOOK_WORKER_ENABLED=false` y reiniciar el
  servicio; revocar la clave SmartBC si hay sospecha de exposicion.
- [ ] Validar Nginx con
  `/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf` antes
  de reload y comprobar `/health`, `/ready`, login e inbox del CRM original.
- [ ] Si la migracion degrada o corrompe datos, detener worker y escrituras,
  restaurar el backup ensayado, validar integridad y conservar logs/outbox para
  investigacion. No ejecutar DDL inverso improvisado en produccion.
