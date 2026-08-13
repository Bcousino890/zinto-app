# Matriz de activación: qué está listo y qué sigue bloqueado

Fecha original: 13 de agosto de 2026, mañana. Un solo lugar para responder
"¿puedo activar esto ya?" sobre cada pieza construida hasta ahora.

> **Actualización, misma fecha, tarde**: con autorización explícita del
> propietario se ejecutó el bloque de cierre del piloto. Estado real ahora:
> `001_integration_api.sql` y `002_performance_indexes.sql` **ya están
> aplicadas en producción**; la regla de Nginx de `internal/` **ya está
> corregida**; `b2883db` **ya está desplegado**. `READ_ONLY_MODE` volvió a
> `true` y `WEBHOOK_WORKER_ENABLED` sigue en `false` — la tabla de abajo
> describía el estado de la mañana y ya no es exacta en esas filas. Detalle
> completo, con evidencia real de cada paso:
> `docs/api/E2E-PILOT-RESULT-2026-08-13.md`.

**Ninguna fila de esta tabla se activa sin instrucción explícita del
propietario, uno por uno.** Nada de lo marcado "listo" se hace por
iniciativa propia.

---

## Tabla resumen

| Pieza | Código | Verificado | Qué falta | Tipo de bloqueo |
|---|---|---|---|---|
| `deal.stage.changed` (`PATCH /api/v1/deals/{id}/stage`) | Completo | 296 tests, staging (esquema `deal_activities`) | Que el propietario abra escrituras públicas (Fase F del plan) | Decisión del propietario |
| `POST /api/v1/conversations` (find-or-create) | Completo | 337 tests | Igual que arriba | Decisión del propietario |
| `updated_since` + `GET /messages/{id}` | Completo | 371 tests, verificado contra esquema real | Nada — es lectura, ya sirve tráfico real en el preview | Ninguno, ya activo |
| Retención/limpieza (idempotencia, outbox, deliveries) | Completo | 386 tests | Nada — **corre automáticamente al desplegar**, sin variable de activación | Ninguno, se activa solo al desplegar |
| Proxy de media (`MEDIA_PROXY_ENABLED`) | Completo | 16+ tests, incluida prueba extremo a extremo | 5 pasos operativos (ver abajo) + regla de Nginx | Pasos operativos + decisión del propietario |
| Métricas (`METRICS_ENABLED`) | Completo | 386 tests (incluidos) | Regla de Nginx + decidir cómo se va a scrapear en la práctica | Paso operativo + decisión del propietario |
| `migrations/001_integration_api.sql` | Completo | 26 operaciones verificadas en staging, 2 bugs de trigger corregidos, rollback probado | Aplicarla en producción | **Explícitamente prohibido hasta nueva instrucción** |
| `migrations/002_performance_indexes.sql` | Completo | Verificada dos veces en staging aislado | Aplicarla en producción | **Explícitamente prohibido hasta nueva instrucción** |
| `send-media` a terceros | Bloqueado a propósito (503) | — | Todo lo del proxy de media, más E2E autorizado | **Explícitamente prohibido hasta nueva instrucción** |
| Corrección de `sender_id=1` en el motor legacy | Sin tocar, ni se tocará sin permiso | Causa raíz y arreglo exacto ya identificados | Decisión sobre intervenir un bundle compilado en producción | **Explícitamente prohibido sin instrucción explícita** |
| `contact_tasks.assigned_to` | Sin implementar | Esquema real confirmado: texto libre, sin forma fiable de validarse | Elegir entre validación best-effort o documentar como campo libre | Decisión del propietario |
| E2E bidireccional | Sin empezar | — | Número de prueba España, número de prueba Chile, empresa piloto | **Dato del propietario** — ver checklist E2E |

---

## Detalle: proxy de media, los 5 pasos operativos (sin cambios respecto a `MEDIA-PROXY-2026-08-13.md`)

1. Volumen escribible para `MEDIA_STORAGE_DIR` (el contenedor corre
   `read_only: true`).
2. Aplicar la regla de Nginx de `internal/` —
   `docs/api/FINDING-NGINX-INTERNAL-PREFIX-2026-08-13.md`.
3. Confirmar que el motor legacy alcanza `MEDIA_INTERNAL_BASE_URL` por la
   red Docker compartida.
4. Ajustar `MEDIA_MAX_BYTES` a los límites reales del proveedor.
5. E2E autorizado antes de abrirlo a un partner real.

## Detalle: qué significa "ninguno, ya activo" para lectura

Los endpoints de solo lectura nuevos (`updated_since`, `GET
/messages/{id}`) no tienen interruptor propio: viven bajo `/api/v1/*` como
el resto de rutas `GET`, que ya están permitidas hoy tanto por
`READ_ONLY_MODE` (que solo bloquea escrituras) como por la regla de Nginx
`limit_except GET HEAD OPTIONS`. En cuanto el propietario haga el push y
despliegue esta rama, estos endpoints de lectura empiezan a responder tráfico
real sin ningún paso adicional — a diferencia de todo lo demás en esta
tabla, que necesita una decisión o un paso explícito.

## Detalle: qué significa "se activa solo al desplegar" para la retención

`startRetentionPurge` se llama incondicionalmente en `src/server.ts`, sin
variable de entorno que lo desactive (mismo criterio que `mediaPurge`, que
ya existía): borra únicamente de las tablas propias
(`integration_api_idempotency`, `integration_api_outbox`,
`integration_api_webhook_deliveries`), nunca de datos de clientes, así que no
necesita el mismo tipo de interruptor que las funciones que sí tocan tráfico
de partners o exponen una ruta nueva. **Efecto colateral a tener en cuenta**:
como `migrations/001_integration_api.sql` sigue sin aplicarse en producción,
esas tablas no existen todavía ahí. En cuanto se despliegue este código sin
haber aplicado la migración, el job de retención va a fallar cada 60
segundos con "relation does not exist" — capturado y registrado como error
(no tumba el proceso), pero generará ruido en los logs hasta que se aplique
la migración. Si el propietario despliega el código antes de decidir aplicar
la migración, conviene que lo sepa de antemano para no confundir ese log con
un problema nuevo.

## Qué no está en esta tabla porque no cambió

`READ_ONLY_MODE=true`, `WEBHOOK_WORKER_ENABLED=false`, y todas las
protecciones de seguridad ya cerradas en bloques anteriores (SSRF, pinning
de socket, rate limiting, redaction de logs, aislamiento multiempresa) siguen
exactamente como estaban — nada de esta sesión las tocó ni las debilitó.
