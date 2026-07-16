# Zinto App

Repositorio principal de Zinto CRM.

## Integraciones y automatizaciones

El repositorio incluye comandos para analizar y preparar Zinto como plataforma de integraciones con otros CRM, Make, Zapier, n8n, ERP, formularios y servicios externos.

### Uso recomendado con Claude Code

```text
/auditar-integraciones-zinto
/implementar-integraciones-zinto <fase concreta>
/actualizar-documentacion-integraciones
```

La guía está en:

```text
.claude/commands/README-integraciones.md
```

Las reglas permanentes de arquitectura, seguridad, pruebas y documentación están en:

```text
CLAUDE.md
```

La documentación técnica de integraciones se mantiene en:

```text
docs/integrations/
```

## Principios de la plataforma

- Aislamiento multitenant por empresa.
- API pública versionada.
- Webhooks firmados y deduplicados.
- Operaciones críticas idempotentes.
- Conectores que utilizan servicios internos de Zinto.
- Sincronización con IDs externos y prevención de bucles.
- Flows versionados, trazables y ejecutados mediante jobs.
- Contratos OpenAPI y pruebas de integración.
