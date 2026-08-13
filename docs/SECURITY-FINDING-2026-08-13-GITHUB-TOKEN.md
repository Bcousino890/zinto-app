# Hallazgo de seguridad: token de GitHub expuesto en el VPS

Fecha de deteccion: 13 de agosto de 2026
Detectado durante: inventario del repositorio para el relevo de la Integration API
Severidad: **alta**
Estado: **abierto, pendiente de accion del propietario**

> Este hallazgo **no** tiene relacion con la Integration API. Se documenta aqui
> porque se encontro en el mismo VPS mientras se localizaba el repositorio.

## Que se encontro

Un token de acceso de GitHub almacenado en texto plano dentro de la URL del
remoto de un clon de trabajo:

- **Archivo:** `/tmp/zinto-repo/.git/config`, linea 10
- **Forma:** `url = https://Bcousino890:gho_<REDACTADO>@github.com/Bcousino890/zinto-codigo-fuente.git`
- **Repositorio afectado:** `Bcousino890/zinto-codigo-fuente`
- **Tipo de token:** prefijo `gho_`, es decir un token OAuth de GitHub, no un PAT
  clasico (`ghp_`) ni uno de alcance fino (`github_pat_`). Esto cambia como se
  revoca; ver mas abajo.

## Por que es grave

1. **Permisos del archivo: `-rw-r--r--` (legible por todos).** El directorio
   `/tmp/zinto-repo` tambien es `drwxr-xr-x`. Cualquier usuario local del VPS, y
   cualquier proceso que corra sin privilegios, puede leer el token.
2. **Esta en `/tmp`.** Es una ubicacion sin expectativa de confidencialidad, que
   suele quedar incluida en volcados de diagnostico y copias improvisadas.
3. **Un token OAuth de usuario hereda el acceso de la cuenta.** No esta acotado a
   un solo repositorio, a diferencia de una deploy key.
4. El clon ocupa 366 MB y contiene codigo fuente del CRM.

## Alcance comprobado

- El token aparece **unicamente** en `/tmp/zinto-repo/.git/config`.
- **No** aparece en `/root/.bash_history`.
- **No** existe `/root/.git-credentials` ni hay `credential.helper` configurado.
- **No** esta en ningun objeto de Git versionado, solo en el fichero de
  configuracion local del clon.

## El token NO fue utilizado

Se detecto mientras se buscaba una via para hacer `push` desde el VPS. **No se
uso**, ni siquiera para la operacion legitima que estaba pendiente: era una
credencial hallada por accidente, para otro repositorio, y usarla sin permiso
explicito habria sido incorrecto. El `push` se resolvio con el propietario
haciendo de puente desde su Mac.

## Remediacion exacta

**El orden importa: revocar primero, limpiar despues.** Borrar el clon no
invalida el token; si ya se filtro, seguiria siendo valido.

### Paso 1 — Revocar el token (hazlo primero)

Al ser un token `gho_`, pertenece a una aplicacion OAuth autorizada (tipicamente
GitHub CLI), no a la lista de "Personal access tokens".

1. Entra en <https://github.com/settings/applications>.
2. Pestana **Authorized OAuth Apps**.
3. Localiza la aplicacion que emitio el token, normalmente **GitHub CLI**.
4. Pulsa **Revoke**.

Alternativa desde una maquina con sesion iniciada de `gh`:

```bash
gh auth logout --hostname github.com
```

### Paso 2 — Comprobar que quedo revocado

Desde tu Mac, sustituyendo `<TOKEN>` por el valor real. Debe responder `401`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: token <TOKEN>" https://api.github.com/user
```

Si devuelve `200`, el token sigue vivo y la revocacion no se aplico.

### Paso 3 — Eliminar el clon del VPS

El clon esta en `/tmp` y no es necesario para ningun servicio en marcha:

```bash
rm -rf /tmp/zinto-repo
```

Si prefieres conservarlo, elimina al menos la credencial del remoto y corrige
los permisos:

```bash
git -C /tmp/zinto-repo remote set-url origin https://github.com/Bcousino890/zinto-codigo-fuente.git
chmod 600 /tmp/zinto-repo/.git/config
```

### Paso 4 — Revisar el uso reciente del token

En <https://github.com/settings/security-log>, filtra por eventos recientes y
comprueba que no haya accesos ni clonaciones que no reconozcas.

## Recomendaciones para evitar la repeticion

1. **No incrustar credenciales en URLs de remoto.** Es la forma mas facil de que
   un token acabe en un fichero legible, en un log o en una captura.
2. **Para automatizar desde el VPS, usar una deploy key SSH por repositorio**,
   con acceso de escritura solo si hace falta. Es revocable de forma
   independiente y no da acceso a toda la cuenta.
3. **No trabajar en `/tmp`** con repositorios que contengan codigo propietario.
4. Mantener el flujo actual (VPS produce commits, el Mac los empuja) es
   perfectamente valido y evita por completo tener credenciales en el servidor.
