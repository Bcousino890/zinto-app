# Instantánea de producción: 25 de agosto de 2026

Esta instantánea corresponde al build activo del contenedor principal de
Zinto en el VPS. Se tomó sin detener el CRM ni modificar datos, sesiones de
WhatsApp, uploads, variables de entorno o la base de datos.

## Contenido

- `app/dist`: backend compilado y frontend distribuido activo.
- `app/migrations`: migraciones presentes en la imagen activa.
- `app/packages`: paquetes locales presentes en la imagen activa.
- `app/package.json` y `app/package-lock.json`.
- `metadata/production-build.txt`: identidad del contenedor, imagen y fechas.

No se incluyen `node_modules`, uploads, datos de usuarios, sesiones de
WhatsApp, copias de seguridad ni secretos. La carpeta de respaldo cifrado del
13 de agosto continúa siendo la referencia para esos datos privados.

## Alcance

El VPS ejecuta un build compilado; esta instantánea no representa el código
fuente TypeScript original. Sirve para reconstrucción, comparación y rollback
del artefacto que estaba activo en producción al tomarla.
