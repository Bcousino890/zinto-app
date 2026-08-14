# Módulo fuente: Acceso API

Este directorio es una reconstrucción mantenible del módulo de creación de
claves API. Está aislado deliberadamente del CRM compilado: no modifica `dist/`
ni el bundle `index-*.js`, y no se despliega por sí solo.

## Qué incluye

- `catalog.ts`: catálogo único de permisos y perfiles predefinidos.
- `permission-model.ts`: normalización, deduplicación y validación de selección.
- `ApiKeyPermissionSelector.tsx`: formulario React con perfiles, checkboxes
  agrupados, resumen, estados de carga, error y éxito.
- `types.ts`: contrato compartido del módulo y del POST de creación.

## Contrato de integración

El host debe proporcionar una función `createApiKey` que invoque:

```http
POST /api/settings/api-keys
Content-Type: application/json
```

Con perfil:

```json
{"name":"SmartBC","profile":"smartbc_crm"}
```

O con permisos explícitos:

```json
{
  "name":"SmartBC personalizado",
  "permissions":["contacts:read","contacts:write","messages:read","messages:send"]
}
```

El backend debe ser la autoridad: validar que no se mezclen `profile` y
`permissions`, rechazar permisos desconocidos, deduplicar y ordenar la lista,
guardar los permisos efectivos y mantener la allowlist de escritura separada.
Los checkboxes no deben habilitar escritura por sí solos.

Ejemplo de adaptador:

```tsx
<ApiKeyPermissionSelector
  createApiKey={(request) => createApiKeyRequest("", request)}
/>
```

## Integración futura con el CRM

1. Recuperar o crear el paquete fuente del frontend que actualmente no existe
   en el VPS; el bundle compilado no es una fuente fiable para editar.
2. Instalar `react` y `@types/react` en el proyecto frontend reconstruido.
3. Montar `ApiKeyPermissionSelector` dentro de `Configuración > Acceso API`.
4. Conectar autenticación, CSRF/CORS y la respuesta real del endpoint.
5. Exponer un endpoint de catálogo del backend para evitar divergencia de
   permisos entre frontend y servidor.
6. Verificar en staging la creación con perfil, selección personalizada,
   permisos inválidos, nombre vacío, clave sin permisos y error de red.

Este módulo no afirma que el endpoint legacy ni este frontend estén desplegados;
es el límite intencionado de esta reconstrucción hasta recuperar el fuente
completo y su pipeline de build.
