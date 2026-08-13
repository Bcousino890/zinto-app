# Autenticacion y permisos

Todas las operaciones excepto `GET /health` requieren una clave API en el
encabezado `Authorization`:

```http
Authorization: Bearer pcp_<64 caracteres hexadecimales>
```

La clave identifica simultaneamente:

- la empresa propietaria de los datos;
- el usuario tecnico usado para auditoria;
- los permisos concedidos;
- restricciones opcionales de IP y expiracion.

Nunca envies `company_id`: Zinto lo obtiene de la clave y filtra cada consulta
y modificacion por esa empresa. Una integracion no puede cambiar de empresa
mediante parametros del cliente.

## Scopes

| Scope | Uso |
| --- | --- |
| `channels:read` | Consultar canales disponibles |
| `contacts:read` | Leer contactos |
| `contacts:write` | Crear, actualizar y archivar contactos |
| `conversations:read` | Leer conversaciones |
| `messages:read` | Leer el historial de mensajes |
| `messages:send` | Enviar mensajes por canales compatibles |
| `notes:write` | Crear, editar y borrar notas |
| `tags:write` | Asociar y quitar etiquetas |
| `webhooks:manage` | Registrar, listar y desactivar webhooks |
| `*` | Acceso completo; reservar para administracion controlada |

`GET /api/v1/me` devuelve los scopes efectivos. Si falta alguno, la API
responde `403 insufficient_scope`.

Los scopes no sustituyen la compuerta operativa de escritura. Aunque una clave
tenga permisos como `contacts:write` o `messages:send`, Zinto puede mantener
las escrituras globalmente cerradas con `READ_ONLY_MODE=true`. Desde el 13 de
agosto de 2026 existe una excepcion controlada: el operador puede permitir
escrituras solo a claves API o empresas concretas mediante
`WRITE_ENABLED_API_KEY_IDS` y `WRITE_ENABLED_COMPANY_IDS`, sin abrir al resto
de partners.

## Custodia de claves

- Guarda la clave en un gestor de secretos o variable de entorno.
- No la incluyas en URLs, codigo fuente, logs, capturas o tickets.
- Usa claves distintas por sistema y ambiente.
- Configura una lista de IPs cuando el origen sea estable.
- Desactiva y reemplaza una clave inmediatamente si se expone.
