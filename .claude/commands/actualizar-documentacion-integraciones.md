Revisa los cambios actuales de Git en Zinto CRM y actualiza únicamente la documentación técnica y los contratos afectados.

# Objetivo

Mantener sincronizados el código, OpenAPI, eventos, modelos, conectores, webhooks y Flows para que futuras integraciones no dependan de documentación desactualizada.

# Reglas

- Ejecuta `git status` y `git diff` antes de editar.
- No modifiques la lógica funcional.
- No despliegues.
- No hagas commit ni push.
- No inventes comportamiento.
- No documentes secretos ni datos personales.
- Mantén cambios ajenos intactos.
- Toda afirmación técnica debe estar respaldada por el código actual.

# Proceso

1. Identifica archivos de código modificados.
2. Detecta endpoints, modelos, migraciones, eventos, jobs, webhooks, conectores, scopes y variables de entorno afectados.
3. Actualiza únicamente los documentos relacionados.
4. Actualiza OpenAPI 3.1 cuando cambie una API.
5. Actualiza el catálogo de eventos cuando cambie un evento.
6. Actualiza documentación de base de datos cuando cambie un modelo o migración.
7. Actualiza documentación de conectores y field mappings.
8. Actualiza documentación del Flow Engine cuando cambien triggers, condiciones, acciones o ejecución.
9. Actualiza la matriz de trazabilidad.
10. Añade o corrige referencias exactas al código.
11. Registra breaking changes, deprecaciones y migraciones necesarias.
12. Ejecuta validaciones no destructivas.

# Referencias

Usa este formato:

`Fuente: ruta/archivo.ext:LÍNEA_INICIO-LÍNEA_FIN — símbolo`

Cuando la documentación describa una propuesta todavía no implementada, marca:

`Estado: arquitectura propuesta, todavía no implementada`

# Comprobaciones obligatorias

- Las rutas y métodos coinciden con el código.
- Los schemas coinciden con validaciones y respuestas.
- Los eventos tienen el nombre y payload correctos.
- Las tablas y relaciones coinciden con modelos y migraciones.
- Los scopes coinciden con la autorización real.
- Las variables de entorno documentadas existen.
- No hay archivos citados que ya no existan.
- OpenAPI es válido.
- Mermaid tiene sintaxis válida.
- No aparecen secretos.
- Cada cambio incompatible está identificado.

# Informe final

Entrega:

- Archivos de código revisados.
- Documentos creados o actualizados.
- Endpoints afectados.
- Eventos afectados.
- Modelos o migraciones afectados.
- Conectores y Flows afectados.
- Breaking changes detectados.
- Validaciones ejecutadas.
- Elementos que requieren revisión humana.