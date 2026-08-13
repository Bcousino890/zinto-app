# Preview deployment on crm.zinto.app

This deployment is intentionally read-only. It does not apply
`migrations/001_integration_api.sql`, start the webhook worker, or permit HTTP
mutations through Nginx.

## Topology

- Existing CRM remains on `127.0.0.1:9000` and is not replaced.
- Integration API binds only to `127.0.0.1:3100`.
- Nginx exposes it at `https://crm.zinto.app/_integration-api/`.
- The container joins the existing external network
  `powerchat-shared-network` for PostgreSQL access.
- The active reverse proxy is aaPanel Nginx, not `/etc/nginx`.
- aaPanel auto-loads the snippet from
  `/www/server/panel/vhost/nginx/extension/crm.zinto.app/`.

## Build and deploy

`GIT_COMMIT` is required: it is stamped into the image so a running container
can be traced back to an exact commit. Deploy only a commit that is already on
GitHub, otherwise the artefact and the repository diverge, which the handoff
lists as a stop condition.

```bash
export GIT_COMMIT=$(git rev-parse HEAD)
docker tag $(docker inspect zinto-integration-api-preview --format '{{.Image}}') zinto-integration-api:rollback-$(date +%Y%m%d)
docker compose -f deploy/docker-compose.preview.yml build
docker compose -f deploy/docker-compose.preview.yml up -d
```

Tagging the running image first is what makes the rollback below possible; do
not skip it.

## Verification

```bash
curl --fail https://crm.zinto.app/_integration-api/health
curl --fail https://crm.zinto.app/_integration-api/ready
curl --fail https://crm.zinto.app/inbox >/dev/null
curl -i -X POST https://crm.zinto.app/_integration-api/api/v1/contacts
```

The last request must be rejected. Authenticated reads require a real tenant
API key and must be tested without printing it.

Confirm the deployed artefact matches the branch:

```bash
docker inspect zinto-integration-api-preview \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
git rev-parse HEAD
```

Both must print the same commit.

## Rollback

To return to the previously running image without touching Nginx or the CRM:

```bash
docker tag zinto-integration-api:rollback-<tag> zinto-integration-api:0.1.0
docker compose -f deploy/docker-compose.preview.yml up -d --force-recreate
```

To withdraw the preview entirely:

1. Remove or move the aaPanel extension snippet out of its extension directory.
2. Run `/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf`.
3. Reload the aaPanel master with `kill -HUP $(pgrep -o nginx)`.
4. Run `docker compose -f deploy/docker-compose.preview.yml down`.

No database rollback is required because the preview applies no migration.
