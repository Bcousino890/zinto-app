# Zinto Integration API: inicio rapido

La API de integracion permite a una empresa conectar su sistema con Zinto sin
compartir sesiones del panel, contrasenas ni identificadores de otra empresa.
La empresa se determina exclusivamente por la clave API.

## Estado de esta version

La version `0.1.0` cubre:

- identidad y permisos de la clave;
- canales y capacidades de envio;
- contactos, notas y etiquetas;
- conversaciones (lectura, y creacion o reutilizacion sin duplicar por
  contacto+canal) e historial completo de mensajes, incluida lectura
  individual de un mensaje por id y filtrado incremental por `updated_since`;
- envio de texto, multimedia, plantillas e interactivos segun el canal;
- lectura de pipelines, etapas, deals y tareas, y cambio de etapa de un deal
  dentro de su mismo pipeline;
- webhooks firmados para sincronizacion de cambios.

**Lo que todavia no existe** (verificar siempre contra
`openapi/openapi.yaml`, que es la fuente de verdad, antes de asumir que algo
esta disponible): creacion/edicion de deals y pipelines, escritura de tareas
(solo lectura hoy), y movimiento de un deal entre pipelines distintos (el
cambio de etapa disponible solo cubre etapas del mismo pipeline).

## URL base

Durante la fase controlada en el VPS:

```text
https://crm.zinto.app/_integration-api
```

Las rutas indicadas en OpenAPI se agregan a esa URL. Por ejemplo:

```text
GET https://crm.zinto.app/_integration-api/api/v1/me
```

## Apertura controlada de escrituras

La API sigue naciendo en modo seguro: `READ_ONLY_MODE=true` bloquea todas las
mutaciones (`POST`, `PATCH`, `PUT`, `DELETE`) bajo `/api/v1/`.

Ahora existe una excepcion controlada para pilotos o partners autorizados: el
operador puede habilitar escrituras solo para una lista cerrada de claves API o
empresas mediante `WRITE_ENABLED_API_KEY_IDS` y/o `WRITE_ENABLED_COMPANY_IDS`.
Si tu clave no esta en esa allowlist, seguiras recibiendo:

```json
{
  "error": {
    "code": "read_only_mode",
    "message": "Write operations are temporarily disabled"
  }
}
```

Esto permite abrir un partner concreto sin abrir escrituras globales para el
resto del sistema.

## Primera llamada

Solicita una clave API de la empresa en Zinto y guardala como secreto. Las
claves empiezan por `pcp_` y solo se muestran completas al crearlas.

```bash
export ZINTO_API_KEY='pcp_REEMPLAZAR'

curl --fail-with-body \
  --header "Authorization: Bearer $ZINTO_API_KEY" \
  https://crm.zinto.app/_integration-api/api/v1/me
```

La respuesta identifica la empresa y los permisos efectivos de la clave:

```json
{
  "data": {
    "company": { "id": "3", "name": "Empresa de ejemplo" },
    "api_key": { "id": "12", "name": "Integracion ERP" },
    "scopes": ["contacts:read", "contacts:write"]
  },
  "meta": { "request_id": "req-123" }
}
```

## Flujo recomendado

1. Verifica la clave con `GET /api/v1/me`.
2. Descubre los canales con `GET /api/v1/channels`.
3. Importa contactos y conversaciones siguiendo `next_cursor`.
4. Registra un webhook HTTPS y guarda el secreto devuelto una sola vez.
5. Usa `Idempotency-Key` en cada creacion y cada envio.
6. Procesa webhooks de forma idempotente usando `X-Zinto-Event-Id`.
7. Reconcilia periodicamente mediante los endpoints de lectura.

## Contrato y ejemplos

- Contrato machine-readable: `openapi/openapi.yaml`
- Autenticacion y permisos: `docs/AUTHENTICATION.md`
- Paginacion: `docs/PAGINATION.md`
- Reintentos seguros: `docs/IDEMPOTENCY.md`
- Webhooks: `docs/WEBHOOKS.md`
- Errores: `docs/ERRORS.md`
- Cliente Node.js: `examples/node-client.ts`
- Receptor de webhooks: `examples/webhook-receiver.ts`
