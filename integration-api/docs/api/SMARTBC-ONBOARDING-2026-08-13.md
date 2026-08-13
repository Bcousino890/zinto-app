# Onboarding de SmartBC

## Estado actual

La API esta implementada en la rama `codex/write-gating` y las escrituras publicas siguen cerradas por defecto. SmartBC no debe recibir una clave con permisos de escritura hasta completar la verificacion de staging y la autorizacion explicita del piloto.

## Configuracion recomendada

- Crear una API key exclusiva para SmartBC y una sola empresa (`company_id` del CRM).
- No compartir claves entre empresas, entornos ni usuarios.
- Empezar con `contacts:read`, `conversations:read`, `messages:read`, `channels:read`, `pipelines:read`, `deals:read` y `tasks:read`.
- Habilitar escrituras solo despues de verificar migraciones y asignar la clave y empresa a las allowlists.
- Para escritura, añadir unicamente `contacts:write`, `conversations:write`, `messages:write`, `pipelines:write`, `deals:write` y `tasks:write` segun la funcionalidad que SmartBC vaya a probar.
- Usar un `Idempotency-Key` unico en cada POST/PATCH/DELETE.
- Registrar y rotar la clave en el secreto de SmartBC; nunca incluirla en frontend, repositorios o logs.

## Flujo bidireccional

1. SmartBC crea o actualiza un contacto mediante la API.
2. Zinto publica el cambio confirmado en el webhook de SmartBC.
3. Los mensajes, notas, etiquetas, conversaciones, tareas, pipelines y deals se sincronizan mediante outbox/webhooks.
4. Los cambios hechos en el CRM se publican mediante los triggers de las migraciones correspondientes.
5. SmartBC deduplica eventos por `event_id` y responde 2xx solo despues de persistirlos.

## Verificacion del piloto

Usar exclusivamente los numeros autorizados por el propietario: España `+34 606806103` y Chile `+56 9 91653343`. No probar con clientes reales sin autorizacion adicional.

Checklist minimo: health/ready, autenticacion, aislamiento de otra empresa, crear contacto, enviar mensaje por cada canal, recibir respuesta, nota, etiqueta, tarea, deal, cambio de etapa y reintento idempotente.

## Cierre y revocacion

Tras el piloto, revisar auditoria y entregas webhook. Si SmartBC deja de estar autorizado, revocar su API key y retirar su `api_key_id` y `company_id` de las allowlists; no borrar datos del CRM como parte de la revocacion.
