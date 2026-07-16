# Comandos de Claude para integraciones de Zinto

Estos comandos preparan Zinto CRM para comunicarse de forma segura con otros CRM, Make, Zapier, n8n, ERP, formularios, mensajería y plataformas externas.

## Orden recomendado

1. Ejecutar `/auditar-integraciones-zinto`.
2. Revisar el informe y `docs/integrations/11-roadmap.md`.
3. Implementar una sola fase con `/implementar-integraciones-zinto <fase>`.
4. Ejecutar `/actualizar-documentacion-integraciones` después de cada cambio.
5. No desplegar ni fusionar hasta que pasen las pruebas multitenant y de contrato.

## Ejemplos

```text
/auditar-integraciones-zinto
/implementar-integraciones-zinto API pública v1 para contactos
/implementar-integraciones-zinto webhooks salientes firmados
/implementar-integraciones-zinto primer conector CRM
/implementar-integraciones-zinto motor de Flows
/actualizar-documentacion-integraciones
```

## Principios obligatorios

- Los conectores nunca escriben directamente en la base de datos.
- Toda operación externa usa los servicios internos de Zinto.
- Toda lectura y escritura está aislada por empresa.
- Las escrituras externas críticas son idempotentes.
- Los webhooks entrantes se verifican y deduplican.
- Los webhooks salientes se firman y reintentan de forma controlada.
- Cada operación relevante utiliza `requestId`, `correlationId` y `causationId`.
- Los Flows se versionan y sus ejecuciones son trazables.
- Los procesos largos se ejecutan mediante jobs o colas.
- Los cambios incompatibles requieren una nueva versión y periodo de deprecación.
- No se considera lista una integración sin pruebas de aislamiento, duplicados, reintentos, conflictos y prevención de bucles.

## Arquitectura objetivo

```text
CRM / Make / Zapier / n8n / ERP
               │
               ▼
API pública y webhooks entrantes
               │
               ▼
Auth + scopes + validación + idempotencia
               │
               ▼
Capa de integraciones y conectores
      ┌────────┼─────────┐
      ▼        ▼         ▼
Sincronización Webhooks  Flow Engine
      └────────┼─────────┘
               ▼
Servicios internos de Zinto
               │
               ▼
Base de datos y eventos internos
```
