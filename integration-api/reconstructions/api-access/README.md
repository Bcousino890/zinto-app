# Reconstrucción: Acceso API

Esta reconstrucción toma como referencia el código fuente recuperado de
`empresa01`, el esquema real `api_keys` y el comportamiento observable del
CRM activo. El bundle compilado no se modifica.

## Incluye

- Validación server-side de `profile` o `permissions`.
- Generación de una clave secreta mostrada una sola vez.
- Hash SHA-256 y prefijo público para persistencia segura.
- Contrato de almacenamiento independiente del ORM, para conectarlo al
  Sequelize del CRM sin duplicar la autoridad de permisos.

## Integración pendiente

El adaptador debe conectarse a las rutas Express del CRM recuperado:

- `GET /api/settings/api-keys/catalog`
- `POST /api/settings/api-keys`
- `PATCH /api/settings/api-keys/:id`

La allowlist operativa de escrituras continúa separada de los scopes. Este
módulo no activa escrituras por sí solo.
