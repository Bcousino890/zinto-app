#!/usr/bin/env bash
set -euo pipefail

# Prepare the API Access files in a recovered CRM source tree. This script is
# intentionally non-destructive: it refuses to overwrite an existing model.

ROOT="${1:-}"
if [[ -z "$ROOT" || ! -d "$ROOT/backend/src" ]]; then
  echo "usage: $0 /path/to/recovered-crm-source" >&2
  exit 2
fi

if [[ ! -f "$ROOT/backend/src/database/index.ts" || ! -f "$ROOT/backend/src/routes/index.ts" ]]; then
  echo "not a supported recovered Express source tree" >&2
  exit 2
fi

MODEL="$ROOT/backend/src/models/ApiKey.ts"
if [[ -e "$MODEL" ]]; then
  echo "refusing to overwrite existing $MODEL" >&2
  exit 3
fi

mkdir -p "$ROOT/reconstructions/api-access"
cp "$(dirname "$0")/legacy-sequelize-model.ts" "$ROOT/reconstructions/api-access/legacy-sequelize-model.ts"
cp "$(dirname "$0")/legacy-express-wiring.ts" "$ROOT/reconstructions/api-access/legacy-express-wiring.ts"
cp "$(dirname "$0")/legacy-migration.sql" "$ROOT/reconstructions/api-access/legacy-migration.sql"

cat <<'EOF'
Prepared the non-destructive reintegration kit.

Next source changes are intentionally manual and reviewable:
1. Copy the model source from reconstructions/api-access/legacy-sequelize-model.ts
   into backend/src/models/ApiKey.ts, removing the exported string wrapper.
2. Add ApiKey to sequelize.addModels(models) in backend/src/database/index.ts.
3. Add an Express router using legacy-express-wiring.ts under the existing isAuth
   middleware and session/admin checks.
4. Apply legacy-migration.sql only against a backed-up staging database.
5. Build backend and frontend, then run the API Access smoke tests.
EOF
