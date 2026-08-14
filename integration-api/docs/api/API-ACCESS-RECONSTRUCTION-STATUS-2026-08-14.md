# API Access Reconstruction Status

## Scope

The recovered `empresa01` source is an older Express/Sequelize CRM. It builds
successfully, but it does not contain the active `api_keys` routes, permission
catalog, or modern integration API. The active production CRM is compiled and
must not be overwritten with this older source.

This folder is the maintainable re-entry point for the API Access module. It
contains the permission catalog, profile resolution, one-time secret creation,
Sequelize store, HTTP adapter, source-compatible model, migration, and wiring
contract.

## Re-entry procedure after a CRM rebuild

1. Copy `ApiKey.ts.template` into `backend/src/models/ApiKey.ts`.
2. Add `ApiKey` to the Sequelize model list in `backend/src/database/index.ts`.
3. Import and mount `backend/src/routes/apiKeyRoutes.ts` from
   `backend/src/routes/index.ts`.
4. Apply `legacy-migration.sql` only after checking the live schema and taking a
   restorable backup.
5. Adapt `legacy-express-wiring.ts` if the source uses a different session shape.
6. Add the frontend selector from `api-access-module/frontend` to the Access
   API settings page. Send either `{ profile }` or `{ permissions }`, never both.
7. Enforce the resolved permissions again in the API-key authentication
   middleware. The UI is convenience only and is not a security boundary.
8. Run backend build, frontend build, unit tests, tenant-isolation tests, and a
   staging smoke test before any production deployment.

For a fresh recovered source tree, run
`reconstructions/api-access/prepare-legacy-reintegration.sh /path/to/source`.
It copies the kit without overwriting existing files and prints the remaining
reviewable wiring steps.

The route registration is captured in
`reconstructions/api-access/legacy-routes-index.patch` so it can be reviewed,
applied, or reverted as one small change.

## Current state

- The reconstruction module is implemented and tested in the integration API
  repository.
- The legacy source was inspected and builds, but is missing this module.
- The files in this folder are not yet wired into the production compiled CRM.
- Production remains unchanged by this reconstruction artifact.

## Security requirements

- Store only SHA-256 hashes and a non-secret prefix; return the plaintext key
  once and never log it.
- Scope every query by the authenticated company.
- Keep admin session authorization separate from API-key permissions.
- Reject unknown permissions and ambiguous profile-plus-permissions requests.
- Keep writes disabled until staging and an authorized pilot pass end-to-end.
