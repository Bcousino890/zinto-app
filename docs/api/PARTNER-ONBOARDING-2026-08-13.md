# Runbook: alta de un partner/cliente nuevo

Fecha: 13 de agosto de 2026. Generaliza el procedimiento ya ejercitado y
verificado con el piloto `bcousinoprop`
(`docs/api/E2E-PILOT-RESULT-2026-08-13.md`) en un proceso repetible, para que
cada alta futura tenga el mismo nivel de cuidado sin depender de recordar el
detalle exacto de la sesión anterior.

**Esto es un runbook operativo, no un endpoint de autoservicio.** No existe
(ni se propone aquí) una ruta pública para que un partner cree su propia
clave — el alta la ejecuta siempre alguien con acceso al VPS, deliberadamente,
igual que se hizo para el piloto.

---

## 0. Antes de empezar

- Confirmar que la empresa (`company_id`) ya existe en `companies`, o
  crearla — esto último **no está cubierto por este runbook**: es una
  operación del CRM legacy (fuera del alcance de la Integration API) y debe
  hacerse por su vía habitual, no por SQL directo salvo que ya sea la
  práctica establecida.
- Confirmar que existe al menos un `user_id` real activo (`active=true`) para
  esa empresa — es quien queda como responsable nominal de la clave (ver
  sección "Atribución" abajo).
- Decidir el conjunto **mínimo** de scopes que el partner necesita — nunca
  `"*"`, nunca "por si acaso". Lista completa de scopes existentes en el
  sistema hoy:

  ```text
  channels:read       contacts:read       contacts:write
  conversations:read  conversations:write messages:read
  messages:send       notes:write         tags:write
  pipelines:read      deals:read          deals:write
  tasks:read          webhooks:manage
  ```

  Ejemplo de una integración típica de solo sincronización (lee y escribe
  contactos/conversaciones, envía mensajes, no toca pipelines/deals):
  `channels:read,contacts:read,contacts:write,conversations:read,conversations:write,messages:read,messages:send`

## 1. Provisionar la clave

```bash
cd /opt/zinto-integration-api/integration-api
./scripts/provision-partner-key.sh <company_id> <user_id> "<nombre descriptivo>" "<scopes separados por coma>"
```

El script:
1. Verifica que la empresa y el usuario existen y coinciden entre sí — si no,
   aborta sin crear nada.
2. Genera la clave (`pcp_` + 64 hex aleatorios) y su hash SHA-256, replicando
   exactamente la lógica de `src/auth/api-key.ts`.
3. Inserta la fila en `api_keys` con los scopes exactos pasados, `is_active=true`.
4. Imprime la clave en bruto **una sola vez**, en su propia línea de salida
   estándar — no queda en ningún log, archivo ni commit. Cópiala de
   inmediato y entrégala al partner por un canal seguro (nunca por email sin
   cifrar, nunca por chat sin borrar el historial después).

## 2. Verificación post-alta (antes de entregar la clave)

```bash
export TEST_KEY='pcp_...'   # la clave recién creada, solo en tu shell, nunca en un archivo
curl -s https://crm.zinto.app/_integration-api/api/v1/me \
  -H "Authorization: Bearer ${TEST_KEY}" | python3 -m json.tool
```

Confirmar en la respuesta: `company.id` es el esperado, `scopes` es
exactamente la lista pedida (ni más ni menos), `api_key.name` es el nombre
descriptivo correcto.

**Nota importante sobre escritura**: mientras `READ_ONLY_MODE=true` (el
estado por defecto y actual), cualquier llamada de escritura con esta clave
nueva dará `503 read_only_mode` — es el comportamiento correcto y esperado,
no un error de aprovisionamiento. La clave queda lista pero inactiva para
escritura hasta que se decida abrir escrituras (ver
`docs/api/ACTIVATION-READINESS-2026-08-13.md`).

## 3. Revocar una clave (si hace falta)

```sql
-- Preferido: desactivar, conserva trazabilidad de auditoría
UPDATE api_keys SET is_active = false WHERE id = <id>;

-- Solo si se pide borrado explícito de datos:
DELETE FROM api_keys WHERE id = <id>;
```

Desactivar es reversible (`is_active = true` la reactiva); borrar no lo es.
Preferir desactivar salvo instrucción explícita de borrar.

## 4. Atribución y límites que siguen siendo globales (léelo antes de dar de alta un segundo partner)

- **El interruptor `READ_ONLY_MODE` es global**, no por empresa ni por clave
  (confirmado en el bloque anterior, ver `docs/api/ACTIVATION-READINESS-2026-08-13.md`).
  Mientras solo exista una empresa con claves de escritura activas, esto es
  equivalente en la práctica a "acotado a esa empresa". **En cuanto exista una
  segunda empresa con clave de escritura, abrir la ventana global abre
  escritura para ambas a la vez** — no hay forma de abrir solo para una de
  las dos con el interruptor actual. Tenlo en cuenta al planear cualquier
  ventana de escritura con más de un partner activo.
- **Rate limits, revisados para tráfico de partner real** (no solo el piloto
  interno): `RATE_LIMIT_PER_KEY_MAX=300`/min, `RATE_LIMIT_PER_COMPANY_MAX=1200`/min,
  `RATE_LIMIT_PER_IP_MAX=600`/min (`src/http/rate-limit.ts`). Son límites
  globales, iguales para toda clave — no hay niveles por partner todavía.
  Evaluados como razonables para un primer partner externo: 5 peticiones por
  segundo por clave cubre holgadamente tanto sincronización inicial por
  cursor (que se autolimita por diseño) como el envío de mensajes en uso
  normal de negocio; una integración que necesite más volumen es una señal
  para revisar el caso puntual, no para subir el límite global sin evidencia.
  Si un partner necesita un límite distinto, hoy la única forma es cambiar la
  variable de entorno global — no hay aislamiento de límites por partner.
  Queda como mejora recomendable, no bloqueante, en
  `docs/api/ACTIVATION-READINESS-2026-08-13.md`.
- **La atribución de envíos (`sender_id`) en el CRM sigue mostrando el bug ya
  documentado** (`sender_id=1` para casi todos los canales) — cualquier
  partner nuevo hereda esa misma limitación hasta que se decida intervenir el
  bundle compilado. Nuestra propia auditoría interna sí atribuye
  correctamente (confirmado en el piloto).

## 5. Checklist resumido

- [ ] Empresa y usuario confirmados y coinciden
- [ ] Scopes mínimos decididos, sin `"*"`
- [ ] `./scripts/provision-partner-key.sh` ejecutado, clave entregada por canal seguro
- [ ] `GET /api/v1/me` verificado con la clave nueva
- [ ] Partner conoce que la API está en modo solo lectura hasta nueva indicación
- [ ] Si es el segundo partner con clave de escritura o más: revisado el punto 4 sobre el interruptor global antes de abrir cualquier ventana
