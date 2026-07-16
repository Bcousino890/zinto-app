Actúa como arquitecto senior de plataformas SaaS, APIs, sistemas distribuidos, integraciones CRM y automatización.

Audita completamente el repositorio de Zinto CRM para determinar qué existe, qué falta y qué debe corregirse antes de conectarlo con otros CRM, Make, Zapier, n8n, ERP, formularios, mensajería y servicios externos.

# Modo de ejecución

Esta tarea es de auditoría y documentación.

- No modifiques la lógica funcional.
- No despliegues.
- No hagas commit ni push.
- No ejecutes migraciones destructivas.
- No elimines archivos.
- No cambies contratos públicos.
- No expongas secretos ni datos personales.
- Puedes crear o actualizar documentación dentro de `docs/integrations/` y `docs/developers/`.

# Evidencia obligatoria

No inventes endpoints, tablas, servicios, eventos ni comportamientos.

Toda afirmación sobre el sistema actual debe citar:

`Fuente: ruta/archivo.ext:LÍNEA_INICIO-LÍNEA_FIN — símbolo o función`

Cuando una conclusión use varios archivos, cita todas las fuentes.

Marca propuestas nuevas como:

`Estado: arquitectura propuesta, todavía no implementada`

Marca conclusiones no demostrables como:

`Estado: inferencia técnica, requiere validación`

# 1. Versión analizada

Registra:

- Commit actual.
- Rama actual.
- Resultado de `git status`.
- Fecha del análisis.
- Lenguajes, frameworks y versiones.
- Gestores de paquetes y lockfiles.
- Puntos de entrada de frontend, backend, workers y procesos auxiliares.
- Configuración de despliegue.

Crea `docs/integrations/00-version-y-alcance.md`.

# 2. Inventario completo

Analiza:

- Frontend y backend.
- API REST y otras interfaces públicas.
- Socket.IO, WebSockets y eventos internos.
- Base de datos, ORM, modelos, migraciones y seeds.
- Autenticación, sesiones, roles y permisos.
- Empresas y aislamiento multitenant.
- Contactos, conversaciones, mensajes, campañas y pipeline.
- Chatbots, automatizaciones y Flows existentes.
- Workers, colas, cron jobs y tareas asíncronas.
- Webhooks entrantes y salientes.
- Integraciones externas actuales.
- Variables de entorno.
- Logs, métricas y auditoría.
- Docker, Nginx, PM2 y CI/CD.
- Pruebas unitarias, de integración y end-to-end.

Crea `docs/integrations/01-estado-actual.md`.

# 3. API actual

Localiza todas las rutas registradas y documenta:

- Método y ruta completa.
- Archivo de registro.
- Middleware.
- Controlador y servicio.
- Autenticación.
- Roles, scopes y tenant requerido.
- Request, response y validaciones reales.
- Códigos de error.
- Tablas afectadas.
- Eventos emitidos.
- Efectos secundarios.
- Pruebas existentes.
- Fuente exacta.

Crea:

- `docs/integrations/02-api-actual.md`
- `docs/integrations/openapi-current.yaml`

OpenAPI debe reflejar exclusivamente rutas confirmadas en el código.

# 4. Modelo canónico

Para cada entidad real documenta:

- ID interno.
- Empresa propietaria.
- IDs externos necesarios.
- Campos obligatorios, opcionales y sensibles.
- Relaciones.
- Validaciones.
- Fuente original.
- Versión o fecha de modificación.
- Reglas propuestas de deduplicación.
- Reglas propuestas de resolución de conflictos.

Evalúa, cuando existan: empresa, usuario, contacto, conversación, mensaje, canal, oportunidad, pipeline, etapa, tarea, nota, etiqueta, campaña, archivo, producto o propiedad, integración, conexión externa, Flow y ejecución.

Crea `docs/integrations/03-modelo-canonico.md`.

# 5. Seguridad multitenant

Busca específicamente:

- Consultas sin filtro de empresa.
- Acceso por IDs de otro tenant.
- Servicios que confían en `companyId` enviado por el cliente.
- Rooms o eventos compartidos incorrectamente.
- Jobs sin tenant.
- Credenciales externas sin empresa obligatoria.
- Cachés sin namespace de tenant.
- Logs, exports o métricas que mezclen empresas.

Para cada riesgo incluye severidad, evidencia, escenario de fallo y corrección propuesta.

Crea `docs/integrations/04-seguridad-multitenant.md`.

# 6. Sincronización

Evalúa soporte actual para:

- Importación inicial.
- Sincronización incremental.
- Dirección unidireccional y bidireccional.
- IDs internos y externos.
- Field mapping.
- Deduplicación.
- Resolución de conflictos.
- Idempotencia.
- Prevención de bucles.
- Reintentos y rate limits.
- Dead-letter queue.

Crea `docs/integrations/05-sincronizacion-y-conflictos.md`.

# 7. Webhooks y eventos

Inventaría todos los webhooks y eventos. Evalúa:

- Firma.
- Timestamp.
- Protección contra replay.
- Dedupe por event ID.
- Persistencia antes de procesar.
- Respuesta rápida.
- Procesamiento asíncrono.
- Reintentos y timeout.
- Historial.
- Dead-letter queue.
- Reenvío manual.
- Correlation IDs.

Crea `docs/integrations/06-webhooks-y-eventos.md`.

# 8. Arquitectura de conectores

Diseña una interfaz común compatible con el proyecto:

- Provider registry.
- Conexión por empresa.
- Credenciales cifradas.
- Cliente HTTP.
- OAuth o API keys.
- Refresh de credenciales.
- Test connection.
- Mappers inbound y outbound.
- Webhook handler.
- Sync service.
- Jobs.
- Logs y métricas.

Los conectores nunca deben escribir directamente en base de datos. Deben utilizar los servicios internos de Zinto.

Crea `docs/integrations/07-arquitectura-conectores.md` con diagramas Mermaid.

# 9. Flow Engine

Audita automatizaciones existentes y diseña:

- Triggers.
- Condiciones.
- Acciones.
- Ramas.
- Esperas persistentes.
- Versiones publicadas e inmutables.
- Ejecuciones trazables.
- Reintentos por paso.
- Idempotencia.
- Límites de pasos, duración y profundidad.
- Prevención de recursión y bucles.
- Jobs asíncronos.
- Correlation y causation IDs.
- Permisos por acción.
- Sandbox o dry-run.

Crea `docs/integrations/08-flow-engine.md`.

# 10. Errores y observabilidad

Evalúa:

- Error contract.
- Request ID.
- Correlation ID.
- Causation ID.
- Logs estructurados.
- Exposición de stack traces.
- Datos sensibles en logs.
- Auditoría de cambios.
- Historial de webhooks, sincronizaciones y Flows.
- Métricas y alertas.

Crea `docs/integrations/09-errores-observabilidad.md`.

# 11. Pruebas

Crea un plan con pruebas obligatorias para:

- Aislamiento entre empresas.
- Idempotencia y condiciones de carrera.
- Duplicados.
- Webhook signatures.
- Replay attacks.
- Reintentos.
- Rate limits.
- Field mapping.
- Conflictos.
- Bucles CRM → Zinto → CRM.
- Renovación de tokens.
- Jobs duplicados.
- Flows recursivos.
- OpenAPI contra implementación.

Crea `docs/integrations/10-plan-pruebas.md`.

# 12. Roadmap

Crea `docs/integrations/11-roadmap.md` con fases pequeñas y reversibles:

1. OpenAPI y documentación real.
2. Request/correlation IDs y errores estandarizados.
3. API pública `/api/v1`.
4. API keys u OAuth con scopes por empresa.
5. Idempotencia.
6. Eventos internos y webhooks salientes.
7. Webhooks entrantes seguros.
8. Registry de conectores y credenciales cifradas.
9. External ID mapping y field mapping.
10. Sincronización unidireccional.
11. Primer conector piloto.
12. Sincronización bidireccional y conflictos.
13. Flow Engine.
14. Constructor visual.
15. Portal de desarrolladores y sandbox.

Para cada fase indica dependencias, archivos afectados, riesgos, pruebas, esfuerzo y rollback.

# Informe final

Entrega:

- Commit y rama analizados.
- Archivos revisados.
- Endpoints encontrados.
- Eventos encontrados.
- Tablas y modelos encontrados.
- Integraciones existentes.
- Riesgos críticos y altos.
- Capacidades listas actualmente.
- Capacidades no listas.
- Roadmap priorizado.
- Comandos de validación ejecutados.
- Limitaciones del análisis.

No declares una capacidad como lista si no tiene implementación verificable, aislamiento multitenant y pruebas.