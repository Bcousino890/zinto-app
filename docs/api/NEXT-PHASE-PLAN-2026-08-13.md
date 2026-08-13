# Plan de la siguiente fase

Fecha: 13 de agosto de 2026
Punto de partida: `3417c32` (GitHub y VPS coinciden, preview read-only)
Complementa el runbook `docs/CLAUDE-HANDOFF-INTEGRATION-API-2026-08-13.md`.

Orden recomendado. Los bloques 1 a 3 son bloqueantes de seguridad y datos; el 4
y el 5 no deben empezarse antes de tener staging, porque implican escrituras.

---

## Bloque 1 — Cerrar el riesgo residual de media (bloqueante)

**Problema.** La API autoriza el destino de `media_url` pero no descarga: lo hace
el motor legacy con su propio cliente. Entre validacion y descarga hay una
ventana de DNS rebinding que nuestro pinning no cubre.

**Opciones evaluadas:**

| Opcion | Coste | Robustez | Depende del compilado |
| --- | --- | --- | --- |
| A. Que el motor legacy use un cliente con pinning | alto | alta | si |
| B. La API descarga con `safe-fetch` y entrega URL interna | medio | alta | no |
| C. Lista de dominios permitidos por empresa | bajo | media | no |

**Recomendacion: opcion B**, y C como refuerzo. B es la unica robusta que no
exige modificar el compilado, que es precisamente lo que el runbook prohibe
tocar.

**Pasos:**

1. Prueba roja: un destino que responde publico en la validacion y privado en la
   descarga debe fallar de forma cerrada.
2. `safe-fetch` descarga la media con limite de tamano y de tipo MIME declarado.
3. Guardar en almacenamiento controlado con nombre no adivinable, sin conservar
   el nombre de fichero del cliente.
4. Entregar al motor legacy una URL interna de confianza, nunca la del partner.
5. Retencion y limpieza de lo descargado.
6. Solo entonces habilitar `send-media`, y unicamente para el piloto.

**Criterio de cierre:** existe una prueba automatizada que demuestra que un
rebinding entre validacion y descarga ya no alcanza la red interna.

---

## Bloque 2 — Limites, redaction y observabilidad (Fase B.4/B.5/B.6)

Pendiente del runbook aun abierto. No requiere staging y reduce riesgo de
inmediato.

1. Rate limit por clave, empresa e IP, con `429` y `Retry-After`.
2. Limites de cuerpo diferenciados por ruta; JSON acotado.
3. Revision de redaction: hoy se redactan `authorization` y `cookie`, pero falta
   auditar query strings, cuerpos de peticion y errores del proveedor legacy,
   que pueden arrastrar datos de cliente.
4. Metricas: latencia por ruta, tasa de error, y una vez activo el worker, lag
   de outbox, dead letters y duplicados.
5. Retencion y limpieza de idempotencia y outbox.

---

## Bloque 3 — Staging con backup restaurable (Fase C, bloqueante)

**No aplicar la migracion en produccion hasta completar esto.**

1. Dump cifrado del PostgreSQL correcto (`powerchat-postgres-bcousinoprop`),
   con checksum guardado aparte.
2. Restaurar en una instancia aislada. Contiene datos de clientes reales: acceso
   restringido y anonimizacion antes de exponerlo a cualquier desarrollador.
3. Aplicar `001_integration_api.sql` alli y medir el tiempo de bloqueo real.
4. Probar insert/update/delete por entidad y comprobar exactamente un evento por
   cambio, con la empresa correcta y sin secretos en el payload.
5. **Probar el rollback restaurando desde el backup**, no solo con `ROLLBACK`.
6. `EXPLAIN (ANALYZE, BUFFERS)` sobre listados e historial con volumen
   representativo; anadir indices solo con evidencia.

**Volumen actual observado** (util para dimensionar): 17 pipelines, 125 etapas,
513 deals, 2 tareas.

---

## Bloque 4 — CRUD de pipelines, etapas, deals y tareas (Fase D)

Se inspecciono el esquema real antes de planificar. **Hay tres trampas que
deben resolverse antes de escribir una sola linea de implementacion.**

### Trampa 1 (critica): `deals.stage` y `deals.stage_id` son vocabularios distintos

No es una denormalizacion. Son dos representaciones paralelas:

- `deals.stage` es `text NOT NULL` con un enum heredado. Distribucion real:
  `lead` 509, `qualified` 2, `closed_won` 1, `closed_lost` 1.
- `deals.stage_id` referencia `pipeline_stages`, cuyos nombres son configurables
  por el usuario: "Arrived", "Envio prop", "Descartado", "Demo Scheduled"...

Comprobacion ejecutada: **en los 513 deals, `stage` difiere del nombre de la
etapa referenciada por `stage_id`.** Es decir, escribir el nombre de la etapa en
`stage` corromperia el enum que el CRM compilado probablemente lee.

**Antes de implementar `deal.stage.changed` hay que determinar, observando el
compilado en staging, cual de estas es cierta:**

- el CRM lee `stage_id` y mantiene `stage` solo por compatibilidad;
- el CRM lee `stage` y `stage_id` es lo nuevo;
- ambos se leen en pantallas distintas, y entonces hace falta una tabla de
  correspondencia explicita.

**No implementar el cambio de etapa por adivinacion.** Un error aqui corrompe 513
registros reales de clientes.

### Trampa 2: `company_id` es NULL-able en `pipelines` y `pipeline_stages`

Hoy no hay ninguna fila con `company_id` nulo (0 de 17 y 0 de 125), pero la
columna lo permite y el modelo contempla plantillas (`is_template`,
`template_category`). Un filtro ingenuo del tipo
`company_id = $1 OR company_id IS NULL` filtraria plantillas entre empresas en
cuanto aparezca la primera fila global.

**Regla:** filtrar siempre por `company_id = $1` estricto. Si se decide exponer
plantillas globales, que sea por un recurso distinto y explicito, nunca mezclado
en el listado de la empresa.

Ademas, `pipeline_stages` tiene `company_id` y `pipeline_id`: hay que validar que
el pipeline pertenece a la empresa **y** que la etapa pertenece a ese pipeline,
para evitar confusion de IDs.

### Trampa 3: `contact_tasks.assigned_to` es `text`, no una FK de usuario

El runbook pide "tareas con asignacion validada dentro de empresa", pero la
columna es texto libre y los 2 valores existentes no son IDs numericos. No se
puede validar por clave foranea.

**Decision requerida del propietario:** o se valida contra usuarios de la empresa
resolviendo por nombre/email, o se documenta explicitamente que el campo es
libre y la API no garantiza que el asignado exista.

### Secuencia de trabajo del bloque

Para cada recurso, en este orden y nunca al reves:

1. Inspeccionar esquema y semantica real del compilado en staging.
2. Definir el recurso en OpenAPI.
3. Escribir pruebas tenant-safe primero, incluidas las de ID ajeno.
4. Implementar repositorio SQL propio con filtro estricto por empresa.
5. Anadir auditoria y outbox.
6. Exponer las rutas.

No delegar el CRUD al legacy si sus rutas no filtran por empresa. Recordar el
pendiente 4 del runbook: **algunas rutas antiguas atribuyen los envios al usuario
1**; hay que corregir la autoria antes de abrir escrituras publicas.

Anadir tambien: creacion/seleccion explicita de conversacion por contacto+canal
sin duplicados, filtros `updated_since` con orden determinista, y endpoints de
estado/reconciliacion de mensajes.

---

## Bloque 5 — E2E bidireccional real (Fase E)

**Requiere del propietario:** numeros de prueba autorizados de Espana y Chile, y
una empresa piloto. No usar clientes al azar.

Cobertura minima: contacto en ambos sentidos; texto saliente y entrante por cada
canal obtenido de `/channels`; imagen, video, audio y documento dentro de los
limites reales del proveedor; plantilla e interactivo solo en canales
compatibles; nota, tag, pipeline, deal y tarea en ambos sentidos; mensajes de
dias anteriores y chats antes vacios; desconexion y reconexion de canal;
timeout, duplicado, evento repetido, orden invertido y caida temporal del
receptor.

Precondicion: el bloque 1 debe estar cerrado antes de probar media hacia
terceros.

---

## Bloque 6 — Auditorias independientes

Cuatro revisiones separadas, sin compartir conclusiones iniciales entre ellas
para reducir sesgo:

1. **Seguridad:** auth, aislamiento, SSRF, secretos, rate limit, SQL, webhook.
2. **Contrato:** OpenAPI frente a rutas, cuerpos, status y scopes.
3. **Datos:** DDL, triggers, transacciones, indices, retencion y restauracion.
4. **Operacion:** Docker, Nginx, observabilidad, rollout, rollback y convivencia
   con el CRM compilado.

Cada hallazgo con severidad, evidencia, archivo/linea, reproduccion y prueba de
regresion. Corregir criticos y altos antes de produccion write-enabled. Reejecutar
una revision final.

---

## Habilitacion gradual (Fase F), solo despues de lo anterior

1. Preview GET-only hasta cerrar hallazgos altos.
2. Migracion con ventana, backup y observacion.
3. Worker primero contra un endpoint interno controlado.
4. Una sola clave y empresa piloto, con scopes minimos.
5. Escrituras en Nginx y `READ_ONLY_MODE=false` solo para el piloto.
6. Observar errores, latencia, lag de outbox, dead letters y duplicados.
7. Expandir por empresas y scopes, con cada paso reversible sin perder eventos.

**`send-media` queda fuera de todas estas etapas hasta cerrar el bloque 1.**
