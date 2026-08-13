# Zinto Integration API: inicio rapido

La API de integracion permite a una empresa conectar su sistema con Zinto sin
compartir sesiones del panel, contrasenas ni identificadores de otra empresa.
La empresa se determina exclusivamente por la clave API.

## Estado de esta version

La version `0.1.0` cubre:

- identidad y permisos de la clave;
- canales y capacidades de envio;
- contactos, notas y etiquetas;
- conversaciones e historial completo de mensajes;
- envio de texto, multimedia, plantillas e interactivos segun el canal;
- webhooks firmados para sincronizacion de cambios.

Pipeline, oportunidades y tareas estan incluidos en el modelo de eventos, pero
sus endpoints CRUD todavia no forman parte de `0.1.0`. No deben considerarse
disponibles hasta que aparezcan en `openapi/openapi.yaml`.

## URL base

Durante la fase controlada en el VPS:

```text
https://crm.zinto.app/_integration-api
```

Las rutas indicadas en OpenAPI se agregan a esa URL. Por ejemplo:

```text
GET https://crm.zinto.app/_integration-api/api/v1/me
```

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

