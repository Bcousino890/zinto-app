# Plan de integracion del catalogo de permisos de API keys

Fecha: 2026-08-14
Repositorio de referencia: `integration-api`
Estado: plan tecnico, sin cambios en `dist`, sin cambios en produccion

## 1. Objetivo y limite

El objetivo es que el CRM permita crear y administrar claves API con permisos
seleccionables de forma segura, y que las mismas claves sean entendidas por la
Integration API. El flujo esperado es:

1. Un administrador abre Configuracion > Acceso API.
2. El frontend carga un catalogo de permisos y perfiles desde el backend del
   CRM.
3. El administrador selecciona un perfil o permisos individuales.
4. El backend valida la seleccion, crea la clave y guarda el conjunto efectivo
   en `api_keys.permissions`.
5. La Integration API autentica la clave y aplica esos permisos a cada ruta.

Este repositorio contiene el punto 5 y parte de la documentacion. No contiene
el backend administrativo que atiende `/api/settings/api-keys` ni el fuente del
frontend que muestra Configuracion > Acceso API.

## 2. Hallazgos verificados

### 2.1 Integration API

- `src/db/api-keys.ts:22-65` lee `api_keys.permissions`, `is_active`,
  `expires_at` y `allowed_ips` mediante `findByHash`; no crea ni actualiza
  claves.
- `src/auth/api-key.ts:9-34` modela los permisos como `string[]` y no conoce
  perfiles, etiquetas, descripciones ni un catalogo administrativo.
- `src/auth/api-key.ts:44-89` autentica la clave, comprueba estado, expiracion,
  IP y rate limits, y expone `permissions` como `request.apiPrincipal.scopes`.
- `src/auth/scopes.ts:3-10` solo comprueba que todos los scopes requeridos
  esten concedidos o que exista `*`.
- `src/app.ts:168-257` registra exclusivamente las rutas de la Integration
  API (`/api/v1/...`); no registra ninguna ruta `/api/settings/...`.
- `src/server.ts` construye `PostgresApiKeyRepository` sobre la base de datos
  compartida, pero no inyecta un servicio de administracion de API keys.

Conclusión: el servicio ya consume el almacenamiento que necesitamos y no
debe convertirse en el dueño de la pantalla administrativa. Añadir aqui
`POST /api/settings/api-keys` crearia dos backends de autoridad para la misma
funcion y no haria que la pantalla existente lo utilizara.

### 2.2 Esquema del CRM

La migracion del CRM `migrations/010-api-access-tables.sql` define:

- `api_keys.company_id` y `api_keys.user_id` como propietarios;
- `key_hash` unico y `key_prefix` para mostrar una referencia no secreta;
- `permissions JSONB`, con comentario de que contiene un array de permisos;
- `is_active`, `expires_at`, `allowed_ips` y `metadata`.

La migracion `011-api-access-enhancements.sql` agrega columnas de webhook y
`features`, pero no define un catalogo de scopes ni perfiles. Por tanto:

- no hace falta una tabla nueva para el catalogo inicial;
- si se guardan perfiles, debe guardarse solo el identificador elegido (por
  ejemplo en `metadata.api_profile`), mientras `permissions` conserva el
  conjunto efectivo e inmutable que usa la autorizacion;
- nunca se debe interpretar `metadata` como permisos efectivos durante la
  autenticacion;
- `media:upload` existe en claves antiguas, pero no forma parte del contrato
  publico de la Integration API documentado en este repositorio. No debe
  aparecer en un perfil publico hasta implementar y documentar su endpoint.

El script `scripts/provision-partner-key.sh:54-76` confirma el contrato de
persistencia actual: recibe una lista explicita, la serializa como JSONB y la
inserta en `api_keys.permissions`.

### 2.3 Frontend y backend compilados

En los artefactos recuperados del CRM se observa que la pantalla actual crea
una clave enviando solo `{ name }` a `POST /api/settings/api-keys` y que el
backend aplica un conjunto heredado por defecto. La pantalla no ofrece
checkboxes ni seleccion de perfil.

No se encontro fuente TypeScript/React ni mapas de fuente utilizables para
esa pantalla; solo bundles compilados bajo `dist/`. El backend administrativo
tambien esta dentro del bundle ejecutable del CRM. En consecuencia, este plan
no autoriza editar los bundles: una edicion directa seria dificil de probar,
no reproducible y se perderia en el siguiente build.

## 3. Contrato objetivo del backend administrativo

El backend fuente recuperado o reconstruido debe exponer, con autenticacion de
administrador y aislamiento por empresa, estas operaciones:

### `GET /api/settings/api-keys/catalog`

Respuesta estable, versionada y sin secretos:

```json
{
  "version": 1,
  "scopes": [
    {
      "id": "contacts:read",
      "group": "CRM",
      "label": "Leer contactos",
      "description": "Consultar contactos de la empresa",
      "dangerous": false,
      "requires": []
    }
  ],
  "profiles": [
    {
      "id": "smartbc_crm",
      "label": "CRM bidireccional",
      "description": "Permisos necesarios para una integracion CRM completa",
      "permissions": ["channels:read", "contacts:read", "contacts:write"]
    }
  ]
}
```

El catalogo debe ser una constante de codigo revisada, no texto enviado por
el navegador. Cada scope debe aparecer una sola vez. Las dependencias se
validan en servidor; el frontend solo las usa para explicar por que una
casilla se marca o desmarca.

### `POST /api/settings/api-keys`

Request compatible:

```json
{
  "name": "smart bc 1",
  "profile": "smartbc_crm"
}
```

o:

```json
{
  "name": "smart bc 1",
  "permissions": [
    "channels:read",
    "contacts:read",
    "contacts:write",
    "conversations:read",
    "conversations:write",
    "messages:read",
    "messages:send"
  ]
}
```

Reglas obligatorias:

1. `name` se valida por longitud, caracteres permitidos y unicidad dentro del
   propietario cuando el producto lo requiera.
2. Se acepta exactamente uno entre `profile` y `permissions`; para mantener
   clientes antiguos, si no llega ninguno se conserva el perfil heredado
   actual y se registra que fue aplicado por compatibilidad.
3. `profile` debe existir en el catalogo publicado.
4. Cada permiso individual debe existir en el catalogo. Permisos desconocidos,
   duplicados, vacios o con tipos incorrectos producen `400`, nunca `500`.
5. Se expanden dependencias, se eliminan duplicados y se ordena el array antes
   de persistirlo. El orden no debe cambiar el significado.
6. `*` no puede seleccionarse desde la interfaz ni por una empresa normal.
   Solo un flujo interno explícitamente reservado a superadmin podría usarlo,
   con auditoria adicional.
7. La empresa y el usuario propietario se obtienen de la sesion autenticada,
   nunca del body del cliente.
8. La clave secreta se muestra una sola vez. Los logs, respuestas posteriores,
   auditorias y listados solo muestran `key_prefix`.
9. La allowlist operativa de escrituras (`WRITE_ENABLED_*`) es una politica de
   despliegue separada. Marcar `contacts:write` no debe activar escrituras por
   si mismo.

La respuesta debe conservar el formato actual de la UI, incluir la clave solo
en la respuesta de creacion y devolver los permisos efectivos y el perfil
publico, nunca `key_hash`.

### `PATCH /api/settings/api-keys/:id`

Debe permitir actualizar nombre, permisos/perfil, expiracion y estado activo
segun las capacidades de la UI. Debe comprobar `company_id` del registro
contra la sesion antes de leer o modificarlo. Un cambio de permisos debe:

- reemplazar el array efectivo atomica y completamente, no concatenarlo sin
  validar;
- registrar actor, empresa, key id, permisos anteriores y nuevos sin incluir
  secretos;
- invalidar cualquier cache de permisos, si se incorpora una cache futura.

La rotacion debe crear una nueva clave y permitir revocar la anterior; no debe
volver a mostrar el secreto antiguo.

## 4. Catalogo inicial recomendado

El catalogo debe derivarse del contrato real publicado en `openapi/openapi.yaml`
y de las comprobaciones de `src/routes`, no de los nombres historicos del CRM.
Como minimo debe cubrir:

- `channels:read`;
- `contacts:read`, `contacts:write`;
- `conversations:read`, `conversations:write`;
- `messages:read`, `messages:send`;
- `notes:read`, `notes:write`;
- `tags:write`;
- `pipelines:read`, `pipelines:write`;
- `deals:read`, `deals:write`;
- `tasks:read`, `tasks:write`;
- `webhooks:manage`;
- `flows:read`;
- `erp.products:read`, `erp.inventory:read`, `erp.sales-orders:read`,
  `erp.invoices:read`.

Los nombres de grupo, etiquetas y perfiles son metadatos administrativos. La
Integration API debe seguir recibiendo solo el array de strings efectivo.

Perfiles sugeridos:

- `crm_read_only`: lecturas CRM, canales y mensajes de lectura;
- `crm_bidirectional`: lecturas y escrituras CRM, excluyendo tareas/deals si
  el partner no las necesita;
- `smartbc_crm`: conjunto exacto acordado con SmartBC;
- `flows_read_only` y `erp_read_only`: módulos independientes de lectura.

No se debe crear un perfil que incluya `media:upload` hasta que exista una ruta
publica implementada, limites, pruebas y documentacion para ese permiso.

## 5. Integracion con este repositorio

### No cambiar

- No añadir `/api/settings/api-keys` a `src/app.ts`.
- No duplicar la tabla `api_keys` ni copiar sus permisos a tablas propias.
- No permitir que la Integration API escriba permisos administrativos.
- No usar `metadata.api_profile` para autorizar una llamada.
- No editar `dist/`, bundles Vite ni `dist/index.js`.

### Cambios que si deben coordinarse

1. El backend administrativo guarda `permissions` como JSON array de strings
   canonicos en la misma base de datos.
2. `PostgresApiKeyRepository` sigue leyendo ese array sin cambios de contrato.
3. Las pruebas de autenticacion deben cubrir una clave creada por cada perfil,
   una clave personalizada, una clave heredada y una clave con permisos
   invalidos que el backend administrativo rechaza.
4. `GET /api/v1/me` debe devolver los permisos efectivos que se guardaron para
   facilitar la verificacion de SmartBC.
5. Las rutas continuan aplicando `assertScopes` y la allowlist operativa por
   separado. Un scope correcto con allowlist cerrada debe seguir dando el error
   operativo esperado, no convertirse en acceso automatico.

## 6. Recuperacion o reconstruccion del fuente

### Opcion preferida: recuperar fuente

Antes de reconstruir, localizar el repositorio, commit de release, CI y
artefactos de build que generaron el CRM actualmente desplegado. La evidencia
minima para aceptar una recuperacion es:

- fuente de frontend y backend en una revision reproducible;
- lockfile y versiones de Node/dependencias;
- variables y secretos fuera del repositorio;
- migraciones ejecutadas y versionadas;
- build reproducible cuya huella coincida con el artefacto de staging;
- prueba automatizada de `GET/POST/PATCH /api/settings/api-keys`.

### Opcion de contingencia: reconstruir solo Acceso API

Si no aparece el fuente original, crear un modulo mantenible separado, por
ejemplo:

```text
api-access-module/
  catalog.ts
  schemas.ts
  service.ts
  repository.ts
  routes.ts
  frontend/
    ApiKeyPermissionsForm.tsx
  tests/
  README.md
```

Este modulo debe integrarse en un backend/frontend fuente reconstruido. No es
seguro inyectarlo directamente en el bundle existente. Mientras no exista un
build fuente completo, se puede mantener como paquete documentado y probado,
pero no debe presentarse como desplegado ni como parte activa de
`crm.zinto.app`.

## 7. Migracion y compatibilidad de datos

### Primer release: sin migracion de datos obligatoria

`permissions JSONB`, `metadata`, `is_active`, `expires_at` y `allowed_ips` ya
son suficientes. El primer release debe leer claves existentes sin modificar
sus permisos. Las claves antiguas siguen funcionando con su array actual.

### Migracion opcional posterior

Solo si se necesita consultar el perfil directamente, añadir una columna
nullable como `api_profile TEXT` o usar `metadata.api_profile` con una decision
unica. No copiar el array efectivo a dos columnas. Si se añade columna, debe
ser aditiva, con indice solo si hay consultas reales, y con rollback que no
borre valores nuevos hasta confirmar que no son necesarios.

Antes de cualquier migracion en produccion:

1. backup restaurable y checksum;
2. snapshot de `api_keys` sin `key_hash` ni secretos;
3. conteo de claves activas por empresa;
4. prueba de lectura y escritura del esquema en staging;
5. migracion transaccional si es posible;
6. verificacion de columnas, constraints y permisos antes de abrir la UI.

## 8. Plan de pruebas de staging

1. Construir backend y frontend desde una revision identificable.
2. Restaurar una copia anonimizada de la base de datos.
3. Verificar que la UI antigua puede crear una clave sin body de permisos y
   conserva el comportamiento heredado.
4. Crear una clave por perfil y una clave personalizada.
5. Probar permisos desconocidos, duplicados, `*`, perfiles inexistentes,
   payloads ambiguos y JSON vacio; todos deben producir `400`.
6. Comprobar aislamiento: un administrador de empresa A no puede leer,
   modificar, desactivar ni rotar una clave de empresa B.
7. Verificar que el secreto solo aparece una vez y no aparece en logs.
8. Usar cada clave contra `/api/v1/me` y una ruta permitida/no permitida.
9. Confirmar que `contacts:write` no abre escrituras si la allowlist esta
   cerrada; luego probar la allowlist solo con una empresa piloto.
10. Ejecutar suite, typecheck, build, lint/diff check y smoke de health/ready.
11. Comparar el frontend compilado de staging con el commit fuente y guardar
    la huella de release.

## 9. Despliegue gradual

Orden recomendado:

1. Desplegar primero backend administrativo con la nueva API desactivada para
   la UI (`feature flag` o ruta no enlazada).
2. Ejecutar migraciones aditivas, si finalmente fueran necesarias.
3. Verificar catalogo, validacion y aislamiento con un administrador de
   staging.
4. Publicar frontend que consume `GET catalog` y envia `profile` o
   `permissions`.
5. Activar la UI para el administrador, no para todos los tenants al mismo
   tiempo.
6. Crear una clave de prueba de empresa controlada y validar `/api/v1/me`.
7. Habilitar SmartBC solo con la allowlist y scopes acordados.
8. Monitorizar errores 400/401/403/409/500, creaciones de claves y cambios de
   permisos durante una ventana definida.

La Integration API puede seguir desplegandose con su procedimiento actual,
porque solo depende de la forma persistida de `api_keys.permissions`. No debe
mezclarse su release con el release del frontend administrativo salvo que se
cambie el contrato de scopes.

## 10. Rollback

### Rollback de frontend

Desactivar el flag de la nueva UI y volver al bundle anterior. Las claves ya
creadas siguen siendo validas porque `permissions` conserva el array efectivo.
No borrar claves ni revertir permisos automaticamente.

### Rollback de backend

Volver al artefacto anterior solo si el endpoint nuevo no es necesario para
leer claves ya creadas. Por eso la compatibilidad exige que el backend antiguo
ignore `metadata.api_profile` y continue leyendo `permissions`.

### Rollback de base de datos

No ejecutar `DROP TABLE api_keys` ni rollback destructivo. Si se añadió una
columna nullable de perfil, dejarla durante la ventana de rollback y eliminarla
solo en una migracion posterior, tras confirmar que ningun backend la lee.

### Rollback operativo de permisos

Para revocar acceso, desactivar la clave (`is_active=false`) o reemplazar su
array por un conjunto minimo validado. La allowlist de despliegue puede retirar
el `api_key_id` o `company_id` sin alterar datos del CRM. Todo cambio debe
quedar auditado.

## 11. Bloqueos que no pueden resolverse desde este repositorio

- Implementar realmente `POST /api/settings/api-keys` en el backend del CRM.
- Añadir checkboxes y perfiles a Configuracion > Acceso API.
- Integrar el nuevo modulo en el router y build del frontend completo.
- Garantizar que el backend compilado acepte `profile` o `permissions` sin
  recuperar/reconstruir su fuente o modificar el bundle, lo cual queda fuera
  de este plan por riesgo de reproducibilidad.
- Publicar la documentación dentro de la pantalla `/settings` sin modificar
  el frontend/backend del CRM.
- Confirmar en producción qué despliegue de CRM generó exactamente el bundle
  observado, mientras no exista un pipeline fuente reproducible.

## 12. Criterios de aceptación

El trabajo se puede declarar integrado cuando, y solo cuando:

- el endpoint de catalogo responde desde el backend fuente del CRM;
- `POST` acepta perfil o permisos, valida ambos y conserva compatibilidad;
- la UI muestra permisos agrupados y estados de dependencia;
- `PATCH` y revocacion tienen aislamiento por empresa y auditoria;
- las claves nuevas aparecen con el array efectivo correcto en
  `GET /api/v1/me`;
- scopes y allowlist operativa siguen siendo controles independientes;
- staging pasa pruebas de seguridad, aislamiento, regresion y rollback;
- el build desplegado tiene commit verificable y no depende de editar `dist`.

Hasta cumplir esos puntos, la capacidad de seleccion de permisos debe
considerarse planificada, no disponible en produccion.
