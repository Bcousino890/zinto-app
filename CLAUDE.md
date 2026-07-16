# CLAUDE.md — Zinto CRM

Este archivo define reglas obligatorias para Claude Code y cualquier agente que modifique Zinto.

## Prioridades

1. Seguridad y aislamiento multitenant.
2. Compatibilidad hacia atrás.
3. Integridad de datos.
4. Idempotencia y prevención de duplicados.
5. Trazabilidad.
6. Pruebas.
7. Documentación basada en el código real.

## Antes de modificar código

- Ejecuta `git status`.
- Revisa cambios existentes y no mezcles trabajo ajeno.
- Identifica servicios, endpoints, modelos, eventos y contratos afectados.
- Define criterios de aceptación y rollback.
- Localiza pruebas existentes.
- Comprueba si el cambio necesita migración, feature flag, cola o credenciales.

## Reglas de arquitectura

- Los controladores deben ser delgados.
- La lógica de negocio pertenece a servicios o casos de uso.
- Los conectores externos nunca escriben directamente en la base de datos.
- Las integraciones deben utilizar los mismos servicios internos que la aplicación.
- Toda lectura y escritura debe filtrar y validar el tenant.
- No confíes en `companyId`, `tenantId` o IDs de recursos enviados por el cliente sin validarlos contra la identidad autenticada.
- Los procesos lentos, masivos o reintentables deben ejecutarse mediante jobs o colas.
- Las llamadas externas deben tener timeout, clasificación de errores, rate limiting y retry controlado.

## Integraciones

Toda integración debe contemplar:

- Empresa propietaria.
- Proveedor.
- Estado de la conexión.
- Credenciales cifradas y revocables.
- Scopes y permisos.
- IDs internos y externos.
- Field mapping.
- Idempotencia.
- Deduplicación.
- Resolución de conflictos.
- Prevención de bucles.
- Reintentos.
- Logs estructurados.
- Correlation ID.
- Pruebas multitenant.

## API pública

- Usa versionado explícito, por ejemplo `/api/v1`.
- Mantén compatibilidad con consumidores existentes.
- Define request y response schemas.
- Implementa scopes, rate limits y paginación.
- Las escrituras críticas deben soportar `Idempotency-Key`.
- Actualiza OpenAPI 3.1 y contract tests.
- No cambies silenciosamente tipos, nombres o semántica de campos publicados.

## Webhooks

### Entrantes

- Verifica firma y timestamp.
- Protege contra replay.
- Deduplica eventos.
- Persiste antes de procesar.
- Responde rápidamente y procesa de forma asíncrona.
- Registra intentos, estado y errores.

### Salientes

- Firma payloads.
- Versiona eventos.
- Usa timeout y reintentos con backoff y jitter.
- Mantén historial de entregas.
- Protege URLs configurables contra SSRF.
- Añade dead-letter queue o mecanismo equivalente.

## Flows

- Separa definición, versión publicada y ejecución.
- Las versiones publicadas son inmutables.
- Cada ejecución mantiene la versión con la que comenzó.
- Registra cada paso, entrada, salida, intento y error.
- Las esperas largas deben persistirse.
- Aplica límites de pasos, duración, profundidad y encadenamiento.
- Previene recursión y bucles.
- Las acciones con efectos externos deben ser idempotentes.

## Seguridad

Nunca:

- Expongas secretos, tokens o contraseñas.
- Registres credenciales completas.
- Devuelvas stack traces en producción.
- Permitas acceso cruzado entre empresas.
- Ejecutues código arbitrario de usuarios sin aislamiento fuerte.
- Realices migraciones destructivas sin un plan explícito y reversible.
- Despliegues, hagas commit o push sin instrucción explícita.

## Pruebas obligatorias

Según el cambio, añade o actualiza:

- Unitarias.
- Integración.
- Contract tests.
- End-to-end.
- Aislamiento multitenant.
- Idempotencia bajo concurrencia.
- Duplicados.
- Reintentos.
- Prevención de bucles.
- Firmas y replay attacks.
- Rollback de migraciones.

## Obligaciones de documentación

Antes de finalizar cualquier cambio:

1. Identifica los documentos afectados.
2. Actualiza la documentación del módulo.
3. Actualiza OpenAPI si cambia una API.
4. Actualiza webhooks y catálogo de eventos.
5. Actualiza base de datos y diagramas si cambia un modelo o migración.
6. Actualiza conectores y field mappings.
7. Actualiza Flow Engine si cambia una automatización.
8. Actualiza la matriz de trazabilidad.
9. Registra breaking changes y deprecaciones.
10. Añade referencias exactas al código.
11. Confirma que no se documentaron funciones inexistentes.

Formato de referencia:

`Fuente: ruta/archivo.ext:LÍNEA_INICIO-LÍNEA_FIN — símbolo`

## Definición de terminado

Un cambio no está terminado hasta que:

- Pasan las validaciones relevantes.
- Existe aislamiento multitenant demostrado.
- No introduce duplicados ni carreras conocidas.
- Los fallos son observables y recuperables.
- La compatibilidad está evaluada.
- Existe rollback.
- La documentación está actualizada.
- Las limitaciones no verificadas están declaradas.