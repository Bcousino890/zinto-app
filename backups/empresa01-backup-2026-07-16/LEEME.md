# empresa01-backup-2026-07-16.tar.gz — dividido en partes

El archivo original pesa **3.26 GB**, por encima del límite de GitHub (100 MB por archivo, 25 MB si subes por la web). Lo dividí en **35 partes de 90 MB** (la última pesa ~51 MB). Los tamaños y el checksum SHA-256 de cada parte están verificados contra el original (ver `SHA256SUMS.txt`).

No pude subir el archivo directamente a GitHub porque no tengo un conector de GitHub conectado ni tus credenciales (no las introduzco por seguridad). Sigue estos pasos desde tu computadora, donde ya tienes tu sesión de git/GitHub autenticada:

## 1. Clona el repo (si no lo tienes ya)

```bash
git clone https://github.com/Bcousino890/zinto-app.git
cd zinto-app
```

## 2. Copia las 35 partes + el manifiesto a una carpeta del repo

Copia todo el contenido de esta carpeta (`empresa01-backup-parts/`) a, por ejemplo, `backups/empresa01-backup-2026-07-16/` dentro del repo clonado.

## 3. Verifica la integridad (opcional pero recomendado)

```bash
cd backups/empresa01-backup-2026-07-16
shasum -a 256 -c SHA256SUMS.txt
```

## 4. Súbelo a GitHub

```bash
git add backups/empresa01-backup-2026-07-16
git commit -m "Backup empresa01 2026-07-16 (dividido en partes)"
git push origin main
```

(Cambia `main` por el nombre de tu rama si es distinto.)

## 5. Para restaurar el backup completo más adelante

```bash
cat empresa01-backup-2026-07-16.tar.gz.part* > empresa01-backup-2026-07-16.tar.gz
tar -tzf empresa01-backup-2026-07-16.tar.gz   # prueba que el tar.gz esté íntegro
```

---

**Nota:** guardar backups binarios grandes en git no es lo ideal a largo plazo (infla el historial del repo). Si esto se va a repetir, vale la pena considerar Git LFS (con cuota suficiente) o un almacenamiento tipo S3/Drive con solo el enlace en el repo.
