# Respaldo completo del 13 de agosto de 2026

Este directorio contiene un respaldo cifrado de las empresas **Zinto** y
**Benjamin Cousino Propiedades (bcousinoprop)**.

El respaldo incluye la base de datos completa, configuraciones del panel de
administracion, planes, archivos multimedia, sesiones de WhatsApp, datos de la
aplicacion, configuracion de la instancia Docker y migraciones.

## Seguridad

El archivo esta cifrado con AES-256-CBC, PBKDF2, SHA-256 y 600000 iteraciones.
La clave no se almacena en GitHub. Se guarda unicamente en el equipo del
propietario en:

`/Users/benjamincousino/Documents/ChatGPT/Zinto Backups/CLAVE 13 de agosto 2026 respaldo empresa datos.txt`

No se debe subir esa clave al repositorio ni compartirla por correo o chat.

## Verificar

```bash
sha256sum -c SHA256SUMS.txt
```

## Descifrar

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 \
  -in zinto-bcousinoprop-respaldo-completo.tar.gz.enc \
  -out zinto-bcousinoprop-respaldo-completo.tar.gz \
  -pass file:"/ruta/privada/a/la/clave.txt"
```

El archivo descifrado contiene informacion personal, credenciales y sesiones
activas. Debe conservarse en almacenamiento privado.
