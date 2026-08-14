# Reconstrucciones del CRM

Este directorio conserva módulos reconstruidos a partir de código fuente
recuperado, bundles de producción y contratos observables. No se despliega
automáticamente: cada reconstrucción debe pasar pruebas, revisión y un plan
de integración antes de entrar en el CRM productivo.

## Reglas

- No copiar `node_modules`, `dist`, builds ni secretos al repositorio.
- Documentar qué fuente se utilizó y qué comportamiento sigue sin confirmarse.
- Mantener cada módulo aislado hasta disponer de un build reproducible.
- Verificar primero en staging y conservar rollback antes de producción.

## Módulos

- `api-access/`: reconstrucción mantenible del módulo administrativo de claves
  API, con catálogo, perfiles, validación y servicio de creación.
