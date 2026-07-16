Actúa como arquitecto e ingeniero senior responsable de implementar una fase segura de la plataforma de integraciones de Zinto CRM.

El objetivo es permitir que Zinto se comunique con otros CRM, Make, Zapier, n8n, ERP, formularios, mensajería y servicios externos mediante API, webhooks, conectores y Flows sin introducir duplicados, fugas entre empresas, bucles, cambios incompatibles ni errores silenciosos.

# Alcance de esta ejecución

Interpreta el texto escrito después del comando como la fase solicitada.

Ejemplo:

`/implementar-integraciones-zinto API pública v1 para contactos`

Si no se indica una fase concreta, selecciona únicamente la primera fase pendiente de `docs/integrations/11-roadmap.md`.

No implementes varias fases grandes de una vez.

# Reglas no negociables

- Lee primero `CLAUDE.md` y la documentación relevante de `docs/integrations/`.
- Ejecuta `git status` y revisa cambios existentes antes de modificar archivos.
- No mezcles cambios ajenos.
- No despliegues a producción.
- No ejecutes migraciones destructivas.
- No elimines contratos existentes.
- Mantén compatibilidad hacia atrás.
- Utiliza feature flags cuando exista riesgo.
- No hagas commit ni push salvo instrucción explícita.
- No expongas secretos ni datos personales.
- Los conectores nunca escriben directamente en base de datos.
- Toda operación externa debe pasar por los servicios internos de Zinto.
- Toda lectura y escritura debe estar aislada por empresa.
- No confíes en un `companyId` enviado por el cliente sin derivarlo y validarlo desde la identidad autenticada.

# 1. Preparación

Antes de implementar:

1. Registra commit, rama y estado del árbol de trabajo.
2. Identifica exactamente los archivos y contratos afectados.
3. Localiza funciones, modelos, endpoints y eventos actuales.
4. Define criterios de aceptación.
5. Define rollback.
6. Define pruebas antes de modificar código.
7. Identifica dependencias de migración, cola, Redis, credenciales o decisiones humanas.

Presenta un plan breve y continúa sin esperar confirmación, salvo que la acción sea irreversible o requiera una credencial real.

# 2. Arquitectura obligatoria

Respeta estas capas:

```text
API pública / Webhooks / Triggers
             │
             ▼
Auth + scopes + validación + idempotencia
             │
             ▼
Capa de aplicación y servicios internos
             │
             ├── Eventos internos
             ├── Jobs y colas
             ├── Conectores
             └── Flow Engine
             │
             ▼
Repositorios/ORM y base de datos
```

No pongas lógica de negocio compleja en rutas, controladores, componentes UI ni handlers de webhook.

# 3. Aislamiento multitenant

Toda entidad y operación nueva relacionada con integraciones debe incluir o derivar de forma segura el tenant.

Comprueba:

- Empresa autenticada.
- Usuario o aplicación autenticada.
- Scopes y permisos.
- Propiedad del recurso.
- Namespace de caché.
- Tenant del job.
- Tenant de la credencial externa.
- Tenant del webhook.
- Tenant del Flow.

Añade pruebas negativas que intenten acceder con otra empresa.

# 4. API pública

Cuando la fase incluya API pública:

- Usa una ruta versionada como `/api/v1`.
- Mantén rutas internas existentes.
- Define request y response schemas.
- Implementa paginación, filtros, orden y límites.
- Utiliza errores estandarizados.
- Implementa scopes.
- Implementa rate limit por empresa y credencial.
- Añade `requestId` y `correlationId`.
- Actualiza OpenAPI 3.1.
- Añade contract tests.

No cambies tipos o nombres de campos publicados sin nueva versión o periodo de deprecación.

# 5. Autenticación de integraciones

Evalúa y aplica el mecanismo que mejor encaje con la arquitectura real:

- API keys por empresa.
- OAuth 2.0 authorization code.
- OAuth 2.0 client credentials.
- Refresh tokens.
- Scopes.
- Rotación y revocación.
- Expiración.
- Auditoría de uso.

Cada credencial debe pertenecer a una empresa y una aplicación.

Nunca almacenes secretos sin cifrado.

Nunca muestres nuevamente un secreto completo después de crearlo.

# 6. Idempotencia

Toda escritura crítica expuesta externamente debe aceptar una clave idempotente.

La identidad debe considerar:

- Empresa.
- Aplicación o credencial.
- Endpoint o tipo de operación.
- `Idempotency-Key`.

Para la misma clave y mismo payload:

- Ejecuta una sola vez.
- Devuelve el mismo resultado en reintentos.

Para la misma clave y payload diferente:

- Devuelve conflicto.

Aplica especialmente a:

- Crear contactos.
- Crear oportunidades.
- Enviar mensajes.
- Ejecutar Flows.
- Procesar webhooks.
- Lanzar campañas.

Evita condiciones de carrera mediante restricción única, lock o mecanismo equivalente.

# 7. Webhooks entrantes

Cuando implementes recepción de webhooks:

1. Identifica proveedor y conexión.
2. Conserva el cuerpo original necesario para verificar firma.
3. Valida firma y timestamp.
4. Protege contra replay.
5. Deduplica por provider event ID o hash seguro.
6. Persiste el evento antes de procesar.
7. Responde rápidamente.
8. Procesa de forma asíncrona.
9. Transforma al modelo canónico.
10. Ejecuta servicios internos de Zinto.
11. Registra estado, intentos y error.
12. Envía fallos permanentes a revisión o dead-letter queue.

Nunca registres tokens ni secretos completos.

# 8. Webhooks salientes

Cada entrega debe tener:

- Event ID estable.
- Versión del evento.
- Tenant.
- Timestamp.
- Payload validado.
- URL de destino validada.
- Firma HMAC y secreto por suscripción.
- Número de intento.
- Estado.
- Código HTTP.
- Timeout.
- Próximo reintento.
- Correlation ID.

Implementa backoff exponencial con jitter, límite de intentos, historial, reenvío manual y desactivación controlada por fallos persistentes.

Protege URLs configurables contra SSRF. No permitas destinos locales, endpoints de metadata ni redes privadas sin una política explícita y segura.

# 9. Conectores

Cada conector debe implementar una interfaz común adaptada al repositorio.

Capacidades posibles:

- Validar configuración.
- Conectar y desconectar.
- Probar conexión.
- Renovar credenciales.
- Importar y exportar.
- Obtener cambios incrementales.
- Recibir webhooks.
- Transformar inbound y outbound.
- Respetar paginación y rate limits.
- Clasificar errores temporales y permanentes.
- Emitir logs y métricas.

Las credenciales deben:

- Pertenecer a una empresa y proveedor.
- Guardarse cifradas.
- Poder rotarse y revocarse.
- No mostrarse completas después de su creación.
- No aparecer en logs.

Crea primero un solo conector piloto y valida el framework antes de duplicarlo.

# 10. Sincronización

Mantén una tabla o modelo de correspondencias externas con:

- Tenant.
- Proveedor.
- Tipo de entidad.
- ID interno.
- ID externo.
- Versión o hash externo.
- Última sincronización.
- Estado.

No uses teléfono o email como único identificador permanente.

Para deduplicar contactos, considera:

1. Relación de ID externo existente.
2. Email normalizado.
3. Teléfono internacional normalizado.
4. Identificador fiscal cuando exista.
5. Regla compuesta configurable.
6. Cola de revisión para coincidencias dudosas.

Registra campos modificados, origen, destino y estrategia de conflicto.

# 11. Prevención de bucles

Toda propagación debe llevar:

- Origin system.
- Event ID.
- Correlation ID.
- Causation ID.
- Sync operation ID.

No vuelvas a exportar automáticamente un cambio a la plataforma que lo originó cuando el contenido relevante no cambió.

Añade una prueba end-to-end para:

```text
CRM externo → Zinto → CRM externo
```

La prueba debe demostrar que no se genera un ciclo infinito.

# 12. Resolución de conflictos

Implementa una estrategia explícita y configurable:

- Zinto tiene prioridad.
- Sistema externo tiene prioridad.
- Última modificación gana.
- Prioridad por campo.
- Solo completar campos vacíos.
- Revisión manual.

Nunca sobrescribas silenciosamente información sin registrar:

- Origen.
- Actor.
- Campos modificados.
- Valor anterior.
- Valor nuevo.
- Correlation ID.
- Regla aplicada.

# 13. Llamadas HTTP externas

Toda llamada debe tener:

- Timeout.
- Abort o cancelación.
- Validación del response.
- Clasificación de errores.
- Retry solo para fallos recuperables.
- Backoff exponencial y jitter.
- Respeto por `Retry-After`.
- Rate limit.
- Correlation ID.
- Logs filtrados.
- Métricas.

No reintentes automáticamente credenciales inválidas, permisos insuficientes, payload inválido ni recursos inexistentes.

# 14. Field mapping

El mapeo debe permitir:

- Campo directo.
- Valor fijo.
- Valor por defecto.
- Concatenación.
- Normalización de email y teléfono.
- Formato de fechas.
- Catálogos.
- Campos personalizados.
- Validación de campos obligatorios.

No permitas ejecutar JavaScript arbitrario proporcionado por usuarios sin aislamiento fuerte y revisión de seguridad.

# 15. Flow Engine

Cuando la fase incluya Flows:

- Separa definición, versión publicada y ejecución.
- Una versión publicada es inmutable.
- Las ejecuciones iniciadas continúan con su versión inicial.
- Cada paso registra entrada, salida, estado, error, intento y duración.
- Las esperas largas se persisten y reanudan mediante jobs.
- Aplica límites de pasos, duración, profundidad y Flows encadenados.
- Previene recursión y eventos repetidos.
- Comprueba permisos de cada acción.
- Hace idempotentes las acciones con efectos externos.
- Incluye sandbox o dry-run cuando sea posible.

# 16. Jobs y colas

Los procesos lentos o reintentables deben ser asíncronos:

- Webhooks.
- Sincronizaciones.
- Importaciones.
- Campañas.
- Flows.
- Renovación de tokens.

Cada job debe incluir tenant, tipo, payload validado, estado, intentos, fecha programada, correlation ID y error.

Los handlers deben ser idempotentes.

Añade dead-letter queue o mecanismo equivalente y reprocesamiento controlado.

# 17. Errores estandarizados

Utiliza un formato público estable, por ejemplo:

```json
{
  "error": {
    "code": "CONTACT_VALIDATION_FAILED",
    "message": "No se pudo crear el contacto",
    "details": [],
    "requestId": "...",
    "correlationId": "..."
  }
}
```

No expongas stack traces ni detalles internos en producción.

# 18. Observabilidad y auditoría

Toda operación relevante debe registrar de forma estructurada:

- Tenant.
- Actor o aplicación.
- Acción.
- Objeto.
- Resultado.
- Request ID.
- Correlation ID.
- Causation ID.
- Duración.
- Error clasificado.

Nunca registres contraseñas, tokens completos, API keys, cookies ni payloads sensibles sin filtrado.

# 19. Pruebas obligatorias

Según el alcance, añade:

## Unitarias

- Validaciones.
- Mappers.
- Firmas.
- Idempotencia.
- Deduplicación.
- Conflictos.
- Condiciones de Flow.

## Integración

- Endpoints.
- Base de datos.
- Jobs.
- Webhooks.
- Conectores.
- Renovación de tokens.
- Multitenancy.

## Contrato

- OpenAPI contra implementación.
- Payloads de eventos.
- Payloads de webhooks.
- Schemas de conectores.

## End-to-end

- Crear por API.
- Sincronizar al sistema externo.
- Recibir actualización externa.
- Evitar duplicado.
- Evitar bucle.
- Reintentar fallo temporal.
- Mandar fallo permanente a revisión.

# 20. Documentación obligatoria

Antes de finalizar:

- Actualiza `docs/integrations/`.
- Actualiza OpenAPI si cambia la API.
- Actualiza el catálogo de eventos si cambia un evento.
- Actualiza modelos y diagramas si cambia base de datos.
- Actualiza la matriz de trazabilidad.
- Registra cualquier breaking change.
- Añade fuentes exactas del código.

# 21. Validación final

Comprueba:

1. Lint y typecheck.
2. Pruebas relevantes.
3. OpenAPI válido.
4. Migraciones revisadas.
5. Aislamiento multitenant.
6. Idempotencia bajo concurrencia.
7. Sin secretos en el diff.
8. Compatibilidad hacia atrás.
9. Rollback documentado.
10. Documentación actualizada.

# Informe final

Entrega:

- Fase implementada.
- Archivos modificados.
- Contratos afectados.
- Migraciones creadas.
- Pruebas ejecutadas y resultados.
- Riesgos pendientes.
- Compatibilidad.
- Rollback.
- Documentación actualizada.
- Elementos no verificados.

No declares la fase terminada si no fue probada o si faltan controles de tenant, idempotencia o seguridad.