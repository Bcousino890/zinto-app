# Plan final de integracion

Fecha: 2026-08-14

Candidate revisado: `c0ab468` (`docs(api): add SmartBC readiness gate`)

Base: `442b952` (`feat(api): close safe Flows and ERP read scope`)

Este plan no despliega, no ejecuta `psql`, no cambia Nginx y no inicia el
worker. La migracion de eventos queda versionada como
`migrations/003_bidirectional_events_outbox.sql` porque
`002_performance_indexes.sql` ya existe en la linea base.

## Estado de la rama principal

La rama `main` del checkout principal no tiene commit y contiene archivos sin
seguimiento. Por tanto no admite un merge seguro ni puede ser el destino de un
fast-forward todavia. No se debe forzar, resetear ni cambiar esa rama hasta que
su propietario decida el destino de esos archivos.

El candidato es descendiente directo de `442b952`; la promocion segura e
inmediata es sobre `codex/flows-erp-scope-close`, no sobre el `main` vacio.

## Promocion revisada

Ejecutar desde el worktree que ya tiene la rama de destino:

```bash
cd '/Users/benjamincousino/Documents/ChatGPT/codigo fuente zinto crm-worktrees/flows-erp-scope-close'
git status --short
git merge-base --is-ancestor 442b952 c0ab468
git merge --ff-only c0ab468
cd integration-api
npm install --no-package-lock
npm test
npm run typecheck
npm run build
git status --short
```

Detenerse si `git status --short` no esta vacio antes del merge, si el
ancestro no coincide, o si cualquiera de las verificaciones falla. El resultado
esperado es un fast-forward a `c0ab468` y un worktree limpio despues de las
pruebas.

## Promocion a main

Solo despues de clasificar o preservar los archivos sin seguimiento del
checkout principal, decidir si `main` debe adoptar la linea API. Si se aprueba,
primero crear un worktree limpio que apunte a un commit de `main`; desde ese
worktree, confirmar que `442b952` es ancestro y ejecutar el mismo
`git merge --ff-only c0ab468` y las mismas verificaciones. Si `main` continua
sin commit, requiere una decision explicita para inicializarlo desde la linea
API; no hay una operacion de merge que pueda hacer eso de forma segura.

## Limites operativos

- No aplicar `001_integration_api.sql`, `002_performance_indexes.sql` ni
  `003_bidirectional_events_outbox.sql` como parte de esta integracion.
- Mantener `READ_ONLY_MODE=true` y `WEBHOOK_WORKER_ENABLED=false`.
- La activacion de SmartBC permanece bloqueada por
  `integration-api/docs/SMARTBC-READINESS-CHECKLIST.md`.
