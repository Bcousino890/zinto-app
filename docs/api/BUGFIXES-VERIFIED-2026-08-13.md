# Dos bugs reales encontrados y corregidos en esta sesión

Fecha: 13 de agosto de 2026. Ninguno de los dos lo introdujo esta sesión de
trabajo: los dos ya estaban en el código que llegó de los agentes en
paralelo (uno propio, uno de un archivo previo tocado indirectamente), y los
dos se encontraron y corrigieron **antes de fusionar a la rama principal**,
durante la verificación independiente que exige la regla de trabajo de este
proyecto (nunca aceptar el resumen de un agente sin correr la suite y leer
el código uno mismo).

---

## Bug 1 — `listMessages`/`findMessage` filtraban por una columna que no existe

**Commit de la corrección:** `1658f28` — `fix(api): filter messages by
created_at, not a nonexistent updated_at`.

### Qué estaba mal

El agente que implementó `updated_since` para contactos, conversaciones y
mensajes replicó el mismo patrón SQL en las tres tablas:

```sql
AND ($3::timestamp IS NULL OR messages.updated_at >= $3::timestamp)
```

`contacts.updated_at` y `conversations.updated_at` existen de verdad en el
esquema real (ya confirmado en pasadas anteriores de esta sesión). **La
tabla `messages` no tiene columna `updated_at`, solo `created_at`.** Esta
consulta habría fallado en producción con
`ERROR: column "updated_at" does not exist` en la primera petición real que
incluyera `updated_since` en `GET /api/v1/conversations/{id}/messages` o
`GET /api/v1/messages/{id}`.

### Cómo se encontró

No fue una casualidad ni una revisión de código genérica: **el propio agente
que escribió el código marcó explícitamente esta suposición como no
verificada** en su informe final, porque las instrucciones de esta sesión le
prohibían tocar una base de datos real. Cito su informe:

> "The only unverifiable assumption: that the legacy `messages` table
> actually has an `updated_at` column in the real Postgres schema. I could
> not check this (no real DB access permitted per task constraints)."

Al recibir ese aviso, se decidió verificarlo antes de fusionar en vez de
confiar en la inferencia razonable del agente (basada en que otras tablas de
la misma familia sí tienen `updated_at`).

### Cómo se validó exactamente

Se restauró un staging aislado nuevo (mismo procedimiento que el resto de la
sesión: backup verificado por checksum, contenedor y volumen dedicados,
destruidos después) y se consultó el catálogo de Postgres directamente:

```sql
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'messages' AND column_name IN ('updated_at', 'created_at');
```

Resultado real:

```
 column_name |          data_type          | is_nullable
-------------+-----------------------------+-------------
 created_at  | timestamp without time zone | YES
```

Confirmado: **no hay fila para `updated_at`**. Solo existe `created_at`. El
staging se destruyó inmediatamente después de esta única consulta de solo
lectura (detalle completo en `docs/api/SCHEMA-VERIFICATION-2026-08-13-02.md`,
aunque esta verificación puntual se hizo en una sesión de staging posterior
a la de ese documento, con el mismo procedimiento).

### La corrección

Filtrar por `messages.created_at` en su lugar, con la limitación documentada
explícitamente en tres sitios (comentario en `src/resources/core.ts`,
descripción de la operación en `openapi/openapi.yaml`, y este documento):
**`updated_since` en mensajes solo detecta mensajes nuevos, nunca un cambio
posterior de `status`/`read_at` en uno ya existente** (esos cambios ya tienen
su propio evento `message.status.updated` en el outbox, así que la
información no se pierde, solo no se puede filtrar por fecha de esa forma
concreta en este endpoint).

### Prueba de regresión

`test/core-repository.test.ts`, caso "scopes messages to the conversation
and to the company, with updated_since apart from the cursor" — asserta
contra el SQL exacto generado (`sql).toContain("messages.created_at >=
$3::timestamp")`), con un comentario explicando por qué no es
`messages.updated_at`. La prueba habría fallado con la versión anterior del
código si el `FakePool` hubiera podido detectar la columna inexistente —
como un `FakePool` no ejecuta SQL real, la única forma de detectar este bug
concreto era la verificación de esquema real de arriba, no un test
unitario. Esa es precisamente la razón por la que este tipo de verificación
contra staging es necesaria además de los tests: los tests unitarios con
pool falso prueban que el código genera el SQL que se le pidió generar,
nunca que ese SQL sea válido contra el esquema real.

---

## Bug 2 — un tag con solo espacios devolvía `500` en vez de `400`

**Commit de la corrección:** `9a334f5` — `fix(api): route the tag param
through the file's own validation helper`.

### Qué estaba mal

`src/routes/contact-mutations.ts` define, cerca del principio del archivo,
un helper genérico para que cualquier fallo de validación de Zod se traduzca
a una respuesta canónica:

```ts
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, "validation_error", "The request body is invalid");
  return result.data;
}
```

Todas las rutas del archivo lo usan — **excepto** `PUT`/`DELETE
/api/v1/contacts/:id/tags/:tag`, que validaban el parámetro de ruta `tag`
así:

```ts
const tag = z.string().trim().min(1).max(100).parse(request.params.tag);
```

`.parse()` (sin el prefijo `safe`) **lanza una excepción `ZodError` sin
envolver** cuando el valor no cumple el esquema. `src/http/errors.ts` no
tiene ningún manejador específico para `ZodError` — solo sabe traducir
`ApiError` a su status code correspondiente; cualquier otra excepción cae en
la rama genérica de `500 internal_error`. Resultado: una petición con un
`tag` inválido no daba `400 validation_error` como el resto de la API,
**daba `500`**.

### Cómo se encontró

Lo encontró el agente de auditoría de contrato OpenAPI, en paralelo, como
efecto colateral de comparar el `openapi.yaml` contra el código real —
notó la inconsistencia de estilo entre esta ruta y las demás del mismo
archivo al leer el handler para verificar qué códigos de error podía
producir. Lo reportó explícitamente como "hallazgo pendiente de decisión del
propietario" en vez de arreglarlo, porque su tarea estaba acotada a auditar
el contrato (el YAML), no a corregir lógica de negocio. Se decidió que era
un arreglo trivial, de bajo riesgo, que sigue exactamente el patrón ya usado
por el resto del archivo, y se aplicó directamente.

### Cómo se validó exactamente

Primer intento de prueba de regresión: un tag de 101 caracteres (por encima
del límite `.max(100)`). **Ese intento falló de una forma reveladora**: la
petición nunca llegó al handler — Fastify (`find-my-way`, su enrutador)
rechaza por defecto cualquier parámetro de ruta de más de 100 caracteres con
un `414 URI Too Long`, **antes** de que el código de la aplicación se
ejecute. Es decir: el caso de "tag demasiado largo" no es alcanzable en la
práctica por esta vía, así que no era la prueba correcta para este bug.

Se reescribió la prueba usando un tag que pasa la comprobación de longitud
de Fastify pero falla la validación de Zod por otro motivo: un único espacio
codificado en la URL (`%20`), que decodifica a `" "`, y que `.trim().min(1)`
rechaza por quedar vacío tras recortar espacios. Con ese caso:

- **Antes de la corrección**: `500`, con el `ZodError` cayendo en la rama
  genérica de `src/http/errors.ts`.
- **Después de la corrección** (usar el helper `parse()` del archivo, igual
  que el resto de rutas): `400 validation_error`, como el resto de la API.

Se confirmó ejecutando la prueba de forma aislada antes y después del
cambio, no solo viendo la suite completa en verde.

### La corrección

```ts
const tagSchema = z.string().trim().min(1).max(100);
// ...
const tag = parse(tagSchema, request.params.tag);
```

Mismo esquema, mismo comportamiento para el caso válido; el helper ya
existente en el archivo se encarga de traducir el fallo a `400
validation_error` en vez de dejarlo caer sin envolver.

### Prueba de regresión

`test/contact-mutations.test.ts`, caso "rejects a whitespace-only tag with
400, not an unwrapped 500" — cubre tanto `PUT` como `DELETE` sobre
`/api/v1/contacts/:id/tags/:tag` con el mismo valor `%20`, con un comentario
que explica por qué se usa ese caso y no uno de longitud.

---

## Por qué estos dos bugs importan más allá de sí mismos

Ninguno de los dos es un fallo de diseño — los dos son exactamente el tipo
de error que el propio proceso de este proyecto está construido para
atrapar antes de que llegue a producción:

- El bug 1 se atrapó porque la regla de este proyecto es **nunca asumir el
  esquema real sin verificarlo**, y porque el agente que escribió el código
  siguió esa misma disciplina al señalar su propia incertidumbre en vez de
  ocultarla.
- El bug 2 se atrapó porque la regla de este proyecto es **verificar el
  trabajo de cada agente de forma independiente, código en mano, no solo su
  resumen** — surgió precisamente de leer el handler completo para otro
  propósito (auditar el contrato), no de buscar bugs de validación a
  propósito.

Ambos quedaron con prueba de regresión antes de fusionarse a la rama
principal.
