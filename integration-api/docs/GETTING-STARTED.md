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
- pipelines, oportunidades y tareas;
- metadatos, asignaciones y ejecuciones de Flows en solo lectura;
- productos, existencias, pedidos de venta y facturas ERP en solo lectura;
- webhooks firmados para sincronizacion de cambios.

Las escrituras de Flows y ERP no forman parte de `0.1.0`. Pipelines, deals,
tareas, ERP y Flows tambien pueden aparecer en el modelo de eventos instalado,
pero SmartBC debe usar unicamente las rutas publicadas en la matriz de
compatibilidad. No existen endpoints de escritura para Flows ni ERP en esta
version.

## URL base

URL de produccion:

```text
https://crm.zinto.app/_integration-api
```

La disponibilidad de escrituras y del worker de webhooks es una configuracion
operativa separada del contrato. Una clave puede tener un scope de escritura y
seguir recibiendo `403` si la empresa o la clave no esta en la allowlist.
Comprueba siempre `/api/v1/me` y la autorizacion operativa del piloto antes de
probar mutaciones.

Las rutas indicadas en OpenAPI se agregan a esa URL. Por ejemplo:

```text
GET https://crm.zinto.app/_integration-api/api/v1/me
```

La base de recursos REST completa es
`https://crm.zinto.app/_integration-api/api/v1`. Consulta
`docs/SMARTBC-COMPATIBILITY.md` para evitar duplicar el prefijo al configurar
clientes que ya guardan `/api/v1` en su URL base.

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
  "meta": { "request_id": "req_123" }
}
```

## Flujo recomendado

1. Verifica la clave con `GET /api/v1/me`.
2. Descubre los canales con `GET /api/v1/channels`.
3. Importa contactos y conversaciones siguiendo `next_cursor`.
4. Crea o reutiliza conversaciones con `contact_id` y `channel_id`.
5. Registra un webhook HTTPS y guarda el secreto devuelto una sola vez.
6. Usa `Idempotency-Key` en cada creacion y cada envio que lo exija.
7. Procesa webhooks de forma idempotente usando `event.id`.
8. Reconcilia periodicamente mediante los endpoints de lectura.

## Contrato y ejemplos

- Contrato machine-readable: `openapi/openapi.yaml`
- Matriz de compatibilidad SmartBC: `docs/SMARTBC-COMPATIBILITY.md`
- Autenticacion y permisos: `docs/AUTHENTICATION.md`
- Paginacion: `docs/PAGINATION.md`
- Reintentos seguros: `docs/IDEMPOTENCY.md`
- Webhooks: `docs/WEBHOOKS.md`
- Errores: `docs/ERRORS.md`
- Cierre Flows/ERP: `docs/FLOWS-ERP-SCOPE-CLOSURE.md`
- Cliente Node.js: `examples/node-client.ts`
- Receptor de webhooks: `examples/webhook-receiver.ts`
