# Auditoría adversarial de aislamiento multiempresa — rutas de escritura (13 de agosto de 2026)

Tercera auditoría del día, dedicada en exclusiva al **aislamiento entre
empresas de las rutas de escritura**. Existe porque el siguiente paso del
proyecto es abrir la API a empresas terceras reales: hasta hoy solo
`bcousinoprop` (`company_id = 3`) ha tenido clave de escritura activa en
producción, nunca dos empresas a la vez, así que ningún fallo de aislamiento
entre inquilinos ha podido manifestarse todavía en datos reales.

**Modelo de amenaza.** Un atacante con una clave de API **válida y legítima**
de la Empresa A que intenta leer, modificar, borrar o simplemente **inferir la
existencia** de datos de una Empresa B cualquiera. No se asume ningún acceso
previo, ni credencial robada, ni acceso a la base de datos: solo la clave que
le vamos a dar de verdad a un tercero.

---

## Resultado en una línea

**No se encontró ninguna fuga cruzada entre empresas.** Las 21 consultas SQL
en alcance filtran estrictamente por la empresa de la clave autenticada, las
cadenas de pertenencia de varios saltos se validan enteras, y ninguna rama de
error distingue «no existe» de «existe pero es de otro». **No se cambió ni una
línea de `src/`.**

Sí se encontró, y se corrigió, un hallazgo real de otra naturaleza: **el
módulo de escritura más antiguo (`src/resources/contact-mutations.ts`) no
tenía ninguna prueba capaz de detectar la pérdida de sus filtros de empresa.**
Se demostró empíricamente (sección 4) que se pueden borrar sus cuatro filtros
`company_id` uno a uno y las 386 pruebas anteriores siguen pasando en verde
las cuatro veces. Eso no es un fallo hoy, pero es exactamente el fallo que
nadie vería mañana. Se cierra con `test/tenant-isolation-writes.test.ts`.

---

## 1. Alcance

### Auditado

| Módulo | Ficheros |
|---|---|
| Cambio de etapa de deal | `src/resources/pipeline-mutations.ts`, `src/routes/pipeline-mutations.ts` |
| Alta/búsqueda de conversación | `src/resources/conversation-mutations.ts`, `src/routes/conversation-mutations.ts` |
| Contactos, notas y etiquetas | `src/resources/contact-mutations.ts`, `src/routes/contact-mutations.ts` |
| Lecturas que alimentan escrituras | `src/resources/pipelines.ts`, `src/resources/core.ts` |
| Envío de mensajes | `src/routes/message-send.ts` |
| Webhooks (alta/listado/baja y reparto) | `src/routes/webhooks.ts`, `src/webhooks/repository.ts`, `src/webhooks/deliveries.ts` |
| Autenticación e idempotencia | `src/auth/api-key.ts`, `src/db/api-keys.ts`, `src/http/idempotency.ts`, `src/db/idempotency.ts` |
| Paginación (cursor controlado por el partner) | `src/http/pagination.ts` |

### Fuera de alcance (por indicación explícita)

`src/delivery/`, `src/media/`, `src/db/retention.ts`, `src/http/metrics.ts`,
`src/routes/metrics.ts`. De `src/webhooks/` solo se leyó `repository.ts` y
`deliveries.ts`, sin modificarlos, porque el reparto del outbox es el único
camino por el que un evento de la Empresa B podría llegar a un endpoint de la
Empresa A y no auditarlo habría dejado el barrido incompleto.

---

## 2. Metodología

Siete pasos, en este orden. Los pasos 1–5 son revisión; el 6 es lo que
convierte la revisión en evidencia.

1. **Inventario exhaustivo de identificadores controlados por el partner.**
   Para cada ruta de escritura, la lista completa de valores que llegan de
   fuera y acaban en un `WHERE`: `id` de la URL, y del cuerpo `contact_id`,
   `channel_id`, `stage_id`, `note_id`, `tag`, `cursor`, `Idempotency-Key`.

2. **Lectura línea por línea de cada sentencia SQL** que toca alguno de esos
   identificadores — no solo el `UPDATE`/`INSERT` final, también la lectura de
   validación previa y el `RETURNING`. Criterio binario: o aparece
   `company_id = <parámetro de la empresa autenticada>` en el `WHERE`, o es un
   hallazgo.

3. **Seguimiento de la cadena completa de pertenencia** cuando el
   identificador referencia otra tabla. El fallo que se buscaba es el clásico:
   comprobar que la fila existe y que su primer salto es nuestro, pero no que
   *todos* los saltos lo son. Cadenas verificadas:
   `stage_id → pipeline_stages.company_id → pipelines.company_id`;
   `note_id → notes.contact_id → contacts.company_id`;
   `message_id → messages.conversation_id → conversations.company_id`;
   `channel_id → channel_connections.company_id`.

4. **Comparación de ramas de error** (404 / 409 / 422 / 400) entre el caso «el
   id no existe en ninguna parte» y el caso «el id existe pero es de otra
   empresa». Cualquier diferencia observable —código, cuerpo, o incluso el
   número de consultas emitidas— es una fuga de información aunque no exponga
   ni un byte de datos.

5. **Búsqueda de filtros laxos.** `company_id` es NULL-able por diseño en
   `pipelines`, `pipeline_stages`, `contacts`, `conversations` y
   `channel_connections` (plantillas globales heredadas). Se buscó
   explícitamente `OR company_id IS NULL` y cualquier variante laxa en todo el
   árbol. Cero apariciones, ni en código ni en pruebas.

6. **Pruebas de mutación (lo decisivo).** Revisar SQL a ojo demuestra que el
   código es correcto *hoy*; no demuestra que la suite vaya a notarlo cuando
   deje de serlo. Así que se hizo lo contrario: **se rompió el aislamiento a
   propósito, un filtro cada vez, y se midió qué pruebas se enteraban.** Nueve
   mutaciones, cada una borrando un único predicado de empresa de una única
   consulta, ejecutando después la suite completa y restaurando el fichero.
   Resultados en la sección 4. Todo el ejercicio se hizo con dobles en
   memoria; `src/` quedó idéntico al terminar (`git diff` vacío sobre `src/`).

7. **Verificación del esquema real** contra las migraciones del CRM
   (`migrations/001-initial-schema.sql`, `migrations/112_add_multi_pipeline_support.sql`,
   `migrations/012-fix-channel-connection-company-ids.sql`) y contra
   `docs/api/SCHEMA-VERIFICATION-2026-08-13-02.md`, para no dar por buena
   ninguna suposición sobre nulabilidad, claves primarias o restricciones.

---

## 3. Veredicto por endpoint

| # | Endpoint | Identificadores del partner | Veredicto |
|---|---|---|---|
| 1 | `PATCH /api/v1/deals/{id}/stage` | `id`, `stage_id` | **Conforme** |
| 2 | `POST /api/v1/conversations` | `contact_id`, `channel_id` | **Conforme** |
| 3 | `POST /api/v1/contacts` | (ninguno) | **Conforme** |
| 4 | `PATCH /api/v1/contacts/{id}` | `id` | **Conforme** — cobertura añadida |
| 5 | `DELETE /api/v1/contacts/{id}` | `id` | **Conforme** — cobertura añadida |
| 6 | `POST /api/v1/contacts/{id}/notes` | `id` | **Conforme** — cobertura añadida |
| 7 | `PATCH /api/v1/notes/{id}` | `id` | **Conforme** — cobertura añadida |
| 8 | `DELETE /api/v1/notes/{id}` | `id` | **Conforme** — cobertura añadida |
| 9 | `PUT /api/v1/contacts/{id}/tags/{tag}` | `id`, `tag` | **Conforme** — cobertura añadida |
| 10 | `DELETE /api/v1/contacts/{id}/tags/{tag}` | `id`, `tag` | **Conforme** — cobertura añadida |
| 11 | `POST /api/v1/messages/send{,-media,-template,-interactive}` | `channel_id` | **Conforme** |
| 12 | `POST /api/v1/webhooks` | (ninguno) | **Conforme** |
| 13 | `DELETE /api/v1/webhooks/{id}` | `id` | **Conforme** |
| 14 | `GET /api/v1/deals`, `/deals/{id}` | `id`, `pipeline_id`, `contact_id`, `cursor` | **Conforme** |
| 15 | `GET /api/v1/pipelines`, `/pipelines/{id}/stages` | `id`, `cursor` | **Conforme** |
| 16 | `GET /api/v1/tasks` | `contact_id`, `cursor` | **Conforme** |
| 17 | `GET /api/v1/contacts`, `/channels`, `/conversations` | `cursor` | **Conforme** |
| 18 | `GET /api/v1/conversations/{id}/messages`, `/messages/{id}` | `id`, `cursor` | **Conforme** |
| 19 | Reparto de webhooks (outbox → endpoint) | (interno) | **Conforme** |
| 20 | Idempotencia (`Idempotency-Key`) | cabecera | **Conforme** en aislamiento; ver hallazgo P2 |

«Cobertura añadida» = el código ya era correcto, pero ninguna prueba lo
sostenía a nivel de SQL; ahora sí. Ver sección 4.

### 3.1 Detalle: `PATCH /api/v1/deals/{id}/stage`

Cuatro sentencias tocan un identificador del partner, y las cuatro filtran:

- `src/resources/pipeline-mutations.ts:135` — lectura de validación del deal:
  `WHERE id = $1 AND company_id = $2`.
- `src/resources/pipeline-mutations.ts:148-150` — resolución de la etapa, con
  la **cadena completa**: `WHERE pipeline_stages.id = $1 AND
  pipeline_stages.company_id = $2 AND pipelines.company_id = $2`, sobre un
  `JOIN` interno con `pipelines`. Este es el punto exacto donde una auditoría
  esperaría encontrar el fallo típico (validar la etapa pero no su pipeline
  padre) y **no está**: los dos saltos se comprueban contra el mismo `$2`.
- `src/resources/pipeline-mutations.ts:165` — el `UPDATE` **repite** el filtro
  (`WHERE id = $1 AND company_id = $2`), no se fía del `SELECT` previo. Esto
  cierra además la ventana lectura→escritura del punto 5 del encargo: la
  escritura es atómicamente autovalidante.
- `src/resources/pipeline-mutations.ts:182` — el `INSERT` en `deal_activities`
  reutiliza `dealId` sin repetir el filtro, pero solo se alcanza después de
  que el `UPDATE` haya devuelto fila, lo que ya prueba la pertenencia. Correcto.

Defensa en profundidad detectada en el esquema: el disparador
`check_deal_stage_company_match()` (`migrations/001-initial-schema.sql`) impide
a nivel de base de datos que `deals.stage_id` apunte a una etapa de otra
empresa. Aunque el filtro de la aplicación desapareciera, el `UPDATE` fallaría.
No se depende de ello, pero conviene saber que está.

Ramas de error: deal ajeno y deal inexistente → ambos `404 deal_not_found`;
etapa ajena y etapa inexistente → ambos `404 stage_not_found`
(`src/routes/pipeline-mutations.ts:36-49`). El `422 stage_pipeline_mismatch`
**solo** puede dispararse cuando la etapa ya ha pasado el filtro de empresa,
es decir, cuando es del propio atacante: no revela nada de nadie.

Caso límite descartado: una etapa con `pipeline_id` nulo no sería alcanzable
(el `JOIN` es interno), y en cualquier caso la migración 112 dejó
`pipeline_stages.pipeline_id` y `deals.pipeline_id` en `NOT NULL` y borró las
etapas globales con `company_id IS NULL`.

### 3.2 Detalle: `POST /api/v1/conversations`

- `src/resources/conversation-mutations.ts:162` — contacto:
  `WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`.
- `src/resources/conversation-mutations.ts:172` — canal:
  `WHERE id = $1 AND company_id = $2`.
- `src/resources/conversation-mutations.ts:189` — búsqueda del par existente:
  `WHERE contact_id = $1 AND channel_id = $2 AND company_id = $3`. Filtra por
  empresa **además** de por el par, que es lo correcto: una fila mal atribuida
  por el motor legacy (mismo contacto y canal, `company_id` de otra empresa) no
  se devuelve.
- `src/resources/conversation-mutations.ts:203` — el `INSERT` fija
  `company_id` desde el principal, nunca desde el cuerpo. El esquema Zod es
  `.strict()` (`src/routes/conversation-mutations.ts:17-20`), así que ni
  `company_id` ni `channel_type` pueden colarse como campos extra;
  `channel_type` se deriva siempre de la fila real del canal.

Ramas de error: contacto ajeno ≡ contacto inexistente
(`404 contact_not_found`); canal ajeno ≡ canal inexistente
(`404 channel_not_found`).

### 3.3 El `pg_advisory_xact_lock` — punto 6 del encargo, revisado a fondo

`src/resources/conversation-mutations.ts:153` toma
`pg_advisory_xact_lock(hashtext($1))` con la clave
`contact_id + ':' + channel_id` (`conversationLockKey`, líneas 74-76),
deliberadamente **sin** `company_id`. El razonamiento documentado en
`docs/api/SCHEMA-VERIFICATION-2026-08-13-02.md` sección 2 era que `contact_id`
es la clave primaria de una sola empresa. **Se comprobó, no se asumió:**

- `migrations/001-initial-schema.sql:120-121` — `contacts.id SERIAL PRIMARY
  KEY`, `company_id INTEGER REFERENCES companies(id)`. Un `contact_id` designa
  exactamente una fila, y por tanto **a lo sumo una empresa**. El razonamiento
  original sigue siendo válido.
- Se verificó además que ninguna migración reasigna contactos entre empresas.
  `012-fix-channel-connection-company-ids.sql` solo rellena `company_id` que
  estaba a `NULL`; nunca lo mueve de una empresa a otra.
- **Colisión deliberada entre empresas:** dos empresas distintas *no pueden*
  producir la misma clave con contactos propios, porque los `contact_id` son
  globalmente únicos. Sí pueden colisionar dos claves distintas a través de
  `hashtext`, que devuelve `int4` (2³² valores). Consecuencia: dos
  transacciones no relacionadas se serializan durante lo que dure una de
  ellas — dos `SELECT` y un `INSERT`. **Confirmado explícitamente: no es un
  fallo de seguridad.** No revela datos, no cambia ninguna respuesta, y el
  retraso es de milisegundos.
- **Vector deliberado (analizado, no un hallazgo):** el lock se toma *antes* de
  validar el contacto, así que la Empresa A puede tomar el lock del par
  `(contacto de B, canal)` nombrando un `contact_id` ajeno. La transacción
  termina inmediatamente después con `contact_not_found`, de modo que el lock
  se retiene el tiempo de dos consultas y se libera solo al terminar la
  transacción. Como oráculo temporal es inservible: para observar la espera,
  la Empresa B tendría que estar creando **en ese preciso instante** una
  conversación para exactamente ese par, que el atacante ya tendría que haber
  adivinado. Como vector de contención está acotado por los límites de tasa
  por clave y por empresa del propio atacante
  (`src/auth/api-key.ts:74-79`). Se documenta por transparencia; **no
  requiere cambio**. Tomar el lock antes de validar es además lo correcto para
  lo que el lock existe: si se tomara después, la ventana que serializa dejaría
  de cubrir la operación entera.

### 3.4 Detalle: contactos, notas y etiquetas

`notes` **no tiene `company_id` propio** (`migrations/001-initial-schema.sql:213-219`):
su empresa solo existe a través de `contact_id`. Las dos sentencias que operan
sobre una nota por id lo resuelven con un join, no con una suposición:

- `src/resources/contact-mutations.ts:238` —
  `UPDATE notes ... FROM contacts WHERE notes.id = $1 AND notes.contact_id = contacts.id AND contacts.company_id = $2`.
- `src/resources/contact-mutations.ts:255` —
  `DELETE FROM notes USING contacts WHERE notes.id = $1 AND notes.contact_id = contacts.id AND contacts.company_id = $2`.

Las demás: `181` (`updateContact`), `204` (`archiveContact`), `221`
(`createNote`, que además valida e inserta en una sola sentencia
`INSERT ... SELECT`, el patrón más fuerte del módulo), `281` y `283`
(`attachTag`/`detachTag`). Todas con filtro estricto. `createContact`
(`150-161`) fija `company_id` desde el principal.

El parámetro `tag` viaja siempre como `$3` parametrizado, nunca interpolado.

### 3.5 Lecturas que alimentan escrituras

- `findDeal` (`src/resources/pipelines.ts:329-330`) y `listDeals` (`305`):
  `deals.company_id = $1`. El `LEFT JOIN` con la etapa (`192-196`) exige
  `pipeline_stages.company_id = deals.company_id`, de modo que `stage_name`
  nunca puede venir de una etapa ajena; una referencia colgante devuelve nulo.
- `listStages` (`265`, `279-281`): comprueba primero que el pipeline es
  nuestro y después filtra las etapas por pipeline **y** empresa **y** empresa
  del pipeline.
- `listChannels` (`src/resources/core.ts:251`), del que depende
  `selectChannel` en el envío de mensajes
  (`src/routes/message-send.ts:59-66`): `WHERE company_id = $1`. Un
  `channel_id` ajeno da `404 channel_not_found` sin llegar nunca al motor de
  entrega.
- `findMessage`/`listMessages` (`354-355`, `330`, `339-340`): `messages` no
  tiene `company_id`; se acota por `conversations.company_id`, igual que las
  notas por `contacts`.

### 3.6 Autenticación, idempotencia, paginación y reparto de webhooks

- `companyId` sale **siempre** de `request.apiPrincipal`, derivado del hash de
  la clave (`src/db/api-keys.ts:29-40`). No hay ni una ruta que lo lea del
  cuerpo, de la query o de una cabecera. Se verificó una por una: las 26
  apariciones de `apiPrincipal!.companyId` en `src/routes/` son todas
  lecturas del principal.
- Idempotencia: la clave de ámbito es `api_key_id` + método + patrón de ruta +
  clave (`src/db/idempotency.ts:20-25`). Como una `api_key` pertenece a una
  sola empresa, una empresa no puede reproducir la respuesta cacheada de otra
  ni provocarle un `409`.
- Cursor de paginación: es opaco pero falsificable por el partner. Se valida
  con Zod (`src/http/pagination.ts:10-13`) y se usa solo en un
  `(created_at, id) < (...)` que va **siempre** en `AND` con el filtro de
  empresa. Un cursor forjado no puede sacar al llamante de su propia empresa;
  como mucho desplaza la ventana dentro de sus propios datos.
- Reparto de webhooks: el fan-out une `endpoints.company_id = outbox.company_id`
  (`src/webhooks/deliveries.ts:40-46`), así que un evento solo puede
  materializarse como entrega hacia un endpoint de su misma empresa.

---

## 4. Hallazgo real: el módulo más antiguo no tenía red de seguridad

**Severidad: media.** No es una vulnerabilidad hoy; es la garantía de que la
próxima lo sería en silencio.

`src/resources/contact-mutations.ts` era el único repositorio de escritura
**sin ninguna prueba a nivel de SQL**. Sus filtros de empresa solo estaban
comprobados contra `MemoryContactMutations`, un doble en memoria de la ruta
(`test/tenant-isolation.test.ts:105-191`) que implementa la comprobación de
empresa *en TypeScript* y por tanto **no puede ver el `WHERE` real**. La ruta
podía seguir devolviendo `404` en la prueba mientras el SQL de producción
devolvía la nota de otra empresa.

Los demás módulos sí tenían esa red: `pipeline-repository.test.ts`,
`core-repository.test.ts`, `pipeline-mutation-repository.test.ts`,
`conversation-mutation-repository.test.ts` y
`delivery-audit-repository.test.ts` usan `FakePool` y comprueban el SQL emitido.

### 4.1 Evidencia — matriz de mutaciones

Cada fila borra **un** predicado de empresa de **una** consulta y ejecuta las
suites. «Suite previa» = las 386 pruebas que existían antes de esta auditoría.

| # | Fichero:línea | Predicado borrado | Suite previa | Suite nueva |
|---|---|---|---|---|
| 1 | `pipeline-mutations.ts:150` | `pipelines.company_id = $2` (2.º salto de la cadena) | detecta (1 fallo) | detecta (2) |
| 2 | `pipeline-mutations.ts:135` | `company_id = $2` (lectura del deal) | detecta (1) | detecta (3) |
| 3 | `pipeline-mutations.ts:165` | `company_id = $2` (`UPDATE deals`) | detecta (1) | detecta (1) |
| 4 | `conversation-mutations.ts:162` | `company_id = $2` (contacto) | detecta (1) | detecta (3) |
| 5 | `conversation-mutations.ts:172` | `company_id = $2` (canal) | detecta (1) | detecta (3) |
| 6 | `conversation-mutations.ts:189` | `company_id = $3` (par existente) | detecta (1) | detecta (4) |
| 7 | `contact-mutations.ts:238` | `contacts.company_id = $2` (`updateNote`) | **386/386 EN VERDE** | detecta (2) |
| 8 | `contact-mutations.ts:255` | `contacts.company_id = $2` (`deleteNote`) | **386/386 EN VERDE** | detecta (2) |
| 9 | `contact-mutations.ts:181` | `company_id = $2` (`updateContact`) | **386/386 EN VERDE** | detecta (2) |
| 10 | `contact-mutations.ts:221` | `contacts.company_id = $2` (`createNote`) | **386/386 EN VERDE** | detecta (2) |

Las mutaciones 7–10 no son teóricas. La 7, por ejemplo, deja
`PATCH /api/v1/notes/{id}` devolviendo **el contenido de la nota de cualquier
otra empresa** y permitiendo sobrescribirlo, con la suite entera en verde.

### 4.2 Corrección aplicada

Ningún cambio en `src/` — el código ya era correcto. Se añade
`test/tenant-isolation-writes.test.ts` (28 pruebas), que cierra el hueco de
las diez mutaciones a la vez.

Lo que lo hace distinto de los dobles existentes: los `FakePool` actuales
responden **por forma de consulta**, devolviendo la fila del fixture sin mirar
los parámetros, así que fijan la forma del SQL pero no pueden reaccionar a la
pérdida de un filtro. El doble nuevo (`FakeCrm`) guarda filas de **dos
empresas con identificadores que colisionan como colisionarían en un ataque
real** y responde cada consulta aplicando **exactamente los predicados de
empresa que el SQL de producción trae escritos**. Si una consulta deja de
filtrar, el doble deja de filtrar también, devuelve la fila ajena, y la prueba
falla.

Fixtures adversariales, con la colisión que pedía el encargo:

- Etapa **901**: `pipeline_stages.company_id = A` (parece nuestra) pero cuelga
  del **pipeline 88, que es de B**. Solo la cadena completa la rechaza;
  comprobar únicamente el primer salto la dejaría pasar. No es un id
  inexistente: es un id que existe y casi encaja.
- Etapa **900** y deal **950**: par internamente coherente **dentro de B**. Si
  el filtro cayera del primer `SELECT`, esa llamada movería un deal ajeno.
- Conversación **7002**: apunta al contacto 101 y al canal 55 —ambos de A—
  pero con `company_id` de B. Es la fila mal atribuida que el motor legacy
  puede haber dejado en un CRM compartido.
- Nota **900** sobre el contacto **500** de B: la nota no tiene empresa
  propia, así que solo el join la delata.

Además de las pruebas de comportamiento, se conserva el guardia textual del
resto de la suite (`expectStrictCompanyFilter`), que prohíbe
`company_id IS NULL` y cualquier `OR ... company_id`.

---

## 5. Hallazgos que requieren decisión del propietario

Ninguno es un fallo de aislamiento entre empresas. **No se ha cambiado nada de
esto**, conforme al encargo.

### P1 — `updateNote` y `deleteNote` ignoran `contacts.deleted_at`

`src/resources/contact-mutations.ts:238` y `:255` no incluyen
`AND contacts.deleted_at IS NULL`, mientras que `createNote` (`:221`),
`updateContact` (`:181`), `archiveContact` (`:204`) y `changeTag` (`:281`,
`:283`) sí lo incluyen.

Efecto: una nota colgada de un contacto borrado por GDPR **de la propia
empresa** sigue siendo legible (por el `RETURNING`) y modificable a través de
`PATCH /api/v1/notes/{id}`. **No es una fuga entre empresas** — el filtro de
empresa está intacto y comprobado, y el contacto es del propio llamante.

Es una decisión de retención/GDPR, no de ingeniería: puede que se quiera que
las notas sobrevivan al borrado lógico del contacto. Se deja como está. Si la
respuesta es que no, la corrección es añadir el mismo predicado que ya usan
las otras cinco sentencias.

### P2 — La huella de idempotencia no incluye los parámetros de ruta

`src/http/idempotency.ts:52-57` construye el ámbito con el **patrón** de ruta
(`request.routeOptions.url`, p. ej. `/api/v1/contacts/:id/notes`) y la huella
`requestHash` se calcula solo sobre el **cuerpo**.

Consecuencia: `POST /api/v1/contacts/1/notes` y `POST /api/v1/contacts/2/notes`
con la misma `Idempotency-Key` y el mismo cuerpo se consideran la misma
operación. La segunda devuelve la respuesta cacheada de la primera —la nota
del contacto 1— y **no escribe nada en el contacto 2**, sin `409`.

**No es un problema de aislamiento**: el ámbito incluye `api_key_id`, y una
clave pertenece a una sola empresa, así que esto solo puede ocurrir dentro de
los propios datos del partner y con claves que él mismo reutiliza mal. Pero es
sorprendente, y con terceros reales alguien lo va a encontrar. Dos salidas
razonables: incluir los parámetros de ruta en `requestHash`, o documentar
explícitamente en `docs/IDEMPOTENCY.md` que la clave debe ser única por
operación lógica incluyendo el recurso destino. Se deja al propietario.

### P3 — Ventana teórica lectura→escritura en `findOrCreateConversation`

`changeDealStage` repite el filtro de empresa en el propio `UPDATE`
(`pipeline-mutations.ts:165`), y `createNote` valida e inserta en una sola
sentencia (`contact-mutations.ts:219-222`). `findOrCreateConversation`, en
cambio, valida con dos `SELECT` y luego hace un `INSERT ... VALUES`
(`conversation-mutations.ts:203`), así que la pertenencia no se revalida
atómicamente en la escritura.

Explotable solo si `contacts.company_id` o `channel_connections.company_id`
cambiaran **durante** la transacción. Se verificó que ninguna migración
reasigna filas entre empresas (`012-fix-channel-connection-company-ids.sql`
solo rellena nulos), y el resultado ni siquiera sería una fuga: dejaría una
conversación de A apuntando a un contacto reasignado, sin exponer dato alguno
de B. **Riesgo residual efectivamente nulo.**

Se menciona solo porque endurecerlo es barato si algún día se permite mover
contactos entre empresas: bastaría convertir el `INSERT` en
`INSERT ... SELECT ... FROM contacts WHERE id = $ AND company_id = $`, el
mismo patrón que ya usa `createNote`. **No se cambia ahora**: tocaría un
camino correcto y muy probado para cubrir un escenario que hoy no existe.

### P4 — Convención de ubicación de `docs/api/`

Existen dos directorios: `docs/api/` en la raíz del repositorio (17
documentos, incluidos todos los que cita esta auditoría) y
`integration-api/docs/api/` (2 documentos antiguos). El commit `8da92f1`
—«mover METRICS-2026-08-13.md a la convención docs/api de la raíz»— fija la
raíz como convención, y ahí se ha escrito este documento. Quedan sin migrar
`CONTRACT-AUDIT-2026-08-13.md` y `DELIVERY-ADAPTER-AUDIT-2026-08-13.md`, a los
que además apunta un comentario de `src/routes/message-send.ts:86`. Conviene
unificarlo, pero no es tarea de esta auditoría.

---

## 6. Lo que se buscó y no se encontró

Se deja constancia explícita para que la próxima auditoría no repita el
trabajo y para que quede claro qué cubre este «no hay nada».

- Ninguna consulta con `OR company_id IS NULL` ni ningún filtro laxo, en
  ningún fichero en alcance.
- Ninguna cadena de pertenencia validada a medias. Las cuatro cadenas
  multisalto del sistema comprueban todos sus saltos.
- Ninguna rama de error que distinga «ajeno» de «inexistente», en ninguno de
  los 20 endpoints. Se comprobó también que no difieren en el **número de
  consultas** emitidas antes de responder.
- Ningún `company_id` procedente del cuerpo, la query o una cabecera. Los
  esquemas Zod de las tres rutas nuevas son `.strict()`, así que un campo
  extra se rechaza con `400` en lugar de ignorarse.
- Ningún identificador interpolado en SQL. Todo va parametrizado, incluidos
  `tag` y el cursor.
- Ninguna reutilización de un id validado en una subconsulta posterior sin
  respaldo: el único caso (`deal_activities`) va detrás de un `UPDATE` que ya
  probó la pertenencia.
- Ningún camino por el que el reparto de webhooks pueda cruzar empresas.

---

## 7. Verificación

```
npm test       → 29 ficheros, 414 pruebas, 414 en verde (386 previas + 28 nuevas)
npm run typecheck → sin errores
npm run build     → sin errores
git diff src/     → vacío (ningún cambio de código de producción)
```

Todo con dobles en memoria. No se tocó Docker ni ninguna base de datos real, y
no se imprimió ni almacenó ningún dato de cliente.

---

## 8. Recomendación operativa

El aislamiento del código está en condiciones de recibir empresas terceras. La
única acción que este documento pide antes de abrir las claves de escritura es
**mantener la regla que la sección 4 acaba de hacer verificable**: todo
repositorio nuevo que lea o escriba una tabla del CRM compartido necesita su
prueba a nivel de SQL con filtro estricto de empresa, no solo un doble en
memoria de la ruta. La forma barata de comprobar que esa prueba sirve de algo
es la del paso 6 de la metodología: borrar el filtro y verificar que la suite
se pone roja. Si no se pone roja, la prueba no protege nada.
