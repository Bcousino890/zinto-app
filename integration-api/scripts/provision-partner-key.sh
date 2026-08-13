#!/usr/bin/env bash
# Provisions a new Integration API key for a company, safely and repeatably.
#
# Replicates exactly the manual procedure used to provision the bcousinoprop
# pilot key on 2026-08-13 (see docs/api/E2E-PILOT-RESULT-2026-08-13.md, B1),
# generalized so future partner onboarding does not depend on re-deriving the
# hashing/format details from memory each time.
#
# What this script does NOT do, on purpose:
#   - It does not run automatically against any environment. You invoke it
#     explicitly, once, per new key.
#   - It does not print the raw key anywhere but this one invocation's
#     stdout. It is not logged, not written to a file, not echoed twice.
#   - It does not choose scopes for you. You pass exactly what the partner
#     needs - see docs/api/PARTNER-ONBOARDING-2026-08-13.md for the full
#     scope list and how to pick the minimum set for a given integration.
#   - It does not decide which company_id/user_id to use - you look those up
#     first (read-only) and pass them in, so a typo here is caught by you
#     before it becomes a live credential for the wrong tenant.
#
# Usage:
#   ./provision-partner-key.sh <company_id> <user_id> "<key name>" "<scope1,scope2,...>"
#
# Example:
#   ./provision-partner-key.sh 3 3 "Partner integration - Acme CRM sync" \
#     "channels:read,contacts:read,contacts:write,conversations:read,conversations:write,messages:read,messages:send"
#
# Requires: docker exec access to powerchat-postgres-bcousinoprop, openssl, python3 or sha256sum.

set -euo pipefail

COMPANY_ID="${1:?Usage: $0 <company_id> <user_id> \"<key name>\" \"<comma,separated,scopes>\"}"
USER_ID="${2:?missing user_id}"
KEY_NAME="${3:?missing key name}"
SCOPES_CSV="${4:?missing scopes (comma-separated, no spaces)}"

PG_CONTAINER="powerchat-postgres-bcousinoprop"
PG_DB="bcousinoprop_db"
PG_USER="powerchat"

echo "== Verificando que la empresa y el usuario existen y coinciden ==" >&2
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -c \
  "SELECT id, name, slug FROM companies WHERE id = ${COMPANY_ID};" >&2
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -c \
  "SELECT id, username, company_id, active FROM users WHERE id = ${USER_ID} AND company_id = ${COMPANY_ID};" >&2

MATCH_COUNT=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -A -c \
  "SELECT count(*) FROM users WHERE id = ${USER_ID} AND company_id = ${COMPANY_ID};")
if [ "$MATCH_COUNT" != "1" ]; then
  echo "ABORTADO: el usuario ${USER_ID} no pertenece a la empresa ${COMPANY_ID}. No se creó ninguna clave." >&2
  exit 1
fi

# Build the JSON permissions array from the comma-separated scope list.
SCOPES_JSON=$(python3 -c "
import json, sys
scopes = sys.argv[1].split(',')
print(json.dumps(scopes))
" "$SCOPES_CSV")

RAW_HEX=$(openssl rand -hex 32)
RAW_KEY="pcp_${RAW_HEX}"
KEY_HASH=$(printf '%s' "${RAW_HEX}" | sha256sum | cut -d' ' -f1)
KEY_PREFIX="pcp_${RAW_HEX:0:8}"

echo "== Creando la clave (name=${KEY_NAME}) ==" >&2
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -c \
  "INSERT INTO api_keys (company_id, user_id, name, key_hash, key_prefix, permissions, is_active, allowed_ips, metadata)
   VALUES (
     ${COMPANY_ID}, ${USER_ID}, '$(printf '%s' "$KEY_NAME" | sed "s/'/''/g")',
     '${KEY_HASH}', '${KEY_PREFIX}',
     '${SCOPES_JSON}'::jsonb,
     true, '[]'::jsonb,
     '{\"provisioned_via\":\"scripts/provision-partner-key.sh\"}'::jsonb
   )
   RETURNING id, name, permissions;" >&2

echo "" >&2
echo "== LA CLAVE SOLO SE MUESTRA UNA VEZ. Cópiala ahora y entrégala al partner por un canal seguro. ==" >&2
echo "" >&2
echo "${RAW_KEY}"
