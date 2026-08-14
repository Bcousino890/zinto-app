# Cierre de alcance: Flows y ERP

Fecha: 2026-08-14

Estado: contrato de solo lectura implementado; escrituras bloqueadas

Entorno: worktree local aislado; no se accedio ni se modifico produccion

## Decision

La API publica puede exponer de forma verificable solo los campos de lectura
que aparecen en las migraciones versionadas. `company_id` se obtiene siempre de
la clave API y cada consulta lo aplica como predicado SQL. No se acepta
`company_id` en path, query ni body.

No se implementa ninguna escritura de Flows o ERP. Las migraciones prueban la
forma de las tablas, pero no prueban por si solas el contrato completo de
validacion, numeracion, transiciones, bloqueos, auditoria, idempotencia y eventos
que una escritura publica necesita. Inventar esa semantica podria corromper el
estado del CRM aun cuando el SQL compilase.

## Contrato listo

| Metodo y ruta | Scope | Datos incluidos |
| --- | --- | --- |
| `GET /api/v1/flows` | `flows:read` | nombre, descripcion, estado, version, creador y timestamps |
| `GET /api/v1/flows/{id}` | `flows:read` | mismo shape de metadatos |
| `GET /api/v1/flows/{id}/assignments` | `flows:read` | canal, estado activo y timestamps, solo si flow y canal pertenecen al tenant |
| `GET /api/v1/flow-executions` | `flows:read` | ciclo de vida, referencias, nodos actuales y duracion; sin payloads |
| `GET /api/v1/erp/products[/{id}]` | `erp.products:read` | catalogo operativo sin imagenes ni custom fields |
| `GET /api/v1/erp/stock-levels` | `erp.inventory:read` | cantidades y referencias resueltas dentro de la empresa |
| `GET /api/v1/erp/sales-orders[/{id}]` | `erp.sales-orders:read` | cabecera y totales, sin lineas, direcciones ni notas |
| `GET /api/v1/erp/invoices[/{id}]` | `erp.invoices:read` | cabecera y saldos, sin lineas, pagos, notas ni PDF |

Todos los listados usan cursor opaco y limite `1..200`. Productos, pedidos y
facturas admiten `updated_since`; los filtros exactos estan en OpenAPI. Los
campos PostgreSQL `numeric` se serializan como strings decimales para no perder
precision. Un ID de otro tenant devuelve el mismo `404` que un ID inexistente.

## Exclusiones deliberadas

Flows no serializa `nodes`, `edges`, `custom_variables`, variables de sesion,
`context_data`, `execution_path`, datos de entrada/salida, debug ni mensajes de
error. Esos JSON pueden contener prompts, URLs, datos personales, secretos o
estado interno sin un schema publico estable.

ERP no serializa imagenes, custom fields, direcciones, notas, terminos, URLs de
PDF, lineas, pagos ni asientos. Proveedores, compras, contabilidad, RRHH,
payroll, restaurante y dental siguen fuera de este cierre: existe DDL, pero no
un contrato publico revisado ni una necesidad minima demostrada para SmartBC.

## Bloqueos de escritura

### Flows

- Crear o editar definitions requiere un schema versionado para cada tipo de
  nodo y una politica de redaccion/cifrado. Hoy `nodes`, `edges` y variables son
  JSONB sin contrato publico verificable.
- Activar/desactivar o asignar un flow requiere validar ownership simultaneo de
  flow y canal, compatibilidad del trigger, exclusividad y efectos del motor. El
  DDL no define esas reglas.
- Reintentar, cancelar o modificar ejecuciones requiere conocer locks, estados
  permitidos y recuperacion del runtime legacy/session. No hay contrato probado.
- La migracion de outbox define eventos versionados de Flow y ejecucion para
  cambios capturados por el CRM. Eso no define el contrato de una mutacion
  publica de definitions, assignments o ejecuciones, que seguiria necesitando
  validacion, idempotencia y semantica de runtime aprobadas.

### ERP

- Productos requieren reglas confirmadas para SKU/variantes, maestros,
  impuestos, custom fields y auditoria. Las migraciones muestran restricciones,
  no el comportamiento completo del motor.
- Inventario requiere lock de stock, movimiento contable inmutable,
  idempotencia, manejo de reservas y transacciones multi-almacen. Es inseguro
  actualizar `stock_levels.quantity` directamente.
- Pedidos requieren numeracion atomica, recalculo server-side de lineas/totales,
  transiciones de estado y efectos de fulfillment/COGS.
- Facturas y pagos requieren numeracion fiscal, impuestos/redondeos, estados,
  asientos, cuentas por cobrar/pagar, reversos y conciliacion. Es inseguro
  aceptar totales calculados por el cliente.
- La migracion de outbox define eventos ERP versionados para cambios existentes
  del CRM. No sustituye el contrato transaccional, las reglas contables ni las
  garantias de una mutacion ERP publica.

## Contrato minimo antes de escribir

Cada futura familia de escritura debe fijar, antes de implementar:

1. Request Zod/OpenAPI estricto, sin campos desconocidos ni `company_id`.
2. Scope de escritura independiente del scope de lectura.
3. Actor de auditoria derivado de `api_keys.user_id`; nunca un usuario fallback.
4. Clave `Idempotency-Key`, hash de metodo+ruta+body y replay de respuesta.
5. Una unica transaccion para validacion, mutacion, auditoria y outbox.
6. Locks y nivel de aislamiento para numeracion, stock, reservas y saldos.
7. Validacion de toda referencia por `(id, company_id)` y `404` opaco.
8. Maquina de estados y codigos de error estables por recurso.
9. Evento versionado con nombre, payload, orden/deduplicacion y reconciliacion.
10. Reversa o compensacion definida; nunca borrado destructivo de contabilidad.

## Checklist exacto de desbloqueo

- [ ] Crear una restauracion de staging sin sesiones, credenciales, workers ni
  salida a canales reales; registrar hash y fecha del backup usado.
- [ ] Ejecutar `npm test`, `npm run typecheck` y `npm run build` en
  `integration-api/` antes de cualquier prueba de datos.
- [ ] Obtener en staging un snapshot de `information_schema.columns`,
  `pg_constraint`, `pg_indexes` y triggers para todas las tablas tocadas; guardar
  el resultado versionado y compararlo con migraciones `001`, `138`, `150-178`,
  `188`, `194`, `201` y `202`.
- [ ] Verificar con dos empresas de staging que cada FK suministrada pertenece a
  la empresa autenticada; cubrir IDs iguales/ajenos, referencias nulas y filas
  legacy con `company_id IS NULL`.
- [ ] Recuperar fuente legible o auditar el bundle vigente para documentar las
  transacciones, locks, numeracion, estados, calculos y side effects reales de
  cada mutacion propuesta.
- [ ] Aprobar una tabla por endpoint con input, output, scope, errores,
  idempotencia, audit row, outbox event y compensacion exactos.
- [ ] Añadir primero tests que fallen para aislamiento entre dos tenants,
  conflicto de idempotencia, replay, referencia cruzada, concurrencia y rollback
  atomico; despues escribir el codigo minimo.
- [ ] Ejecutar pruebas concurrentes: misma numeracion, mismo SKU, mismo stock y
  misma clave de idempotencia; demostrar una sola mutacion efectiva.
- [ ] Demostrar que un fallo despues del cambio de negocio pero antes del outbox
  revierte ambos, y que un retry devuelve la respuesta persistida.
- [ ] Reconciliar por GET el estado final y verificar evento firmado sin enviar
  mensajes ni activar flows contra clientes reales.
- [ ] Documentar migracion reversible, backup, metricas, alertas, kill switch y
  rollback; mantener `READ_ONLY_MODE=true` durante la validacion.
- [ ] Obtener aprobacion explicita del responsable de producto/datos para una
  sola familia de recursos y un tenant piloto antes de habilitarla.

Hasta completar toda la lista para una familia concreta, esa escritura sigue
fuera de OpenAPI y debe responder por ausencia de ruta o por el safety switch de
solo lectura. Este documento no autoriza despliegue ni cambios en produccion.
