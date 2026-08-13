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

## Verification

```bash
curl --fail https://crm.zinto.app/_integration-api/health
curl --fail https://crm.zinto.app/_integration-api/ready
curl --fail https://crm.zinto.app/inbox >/dev/null
curl -i -X POST https://crm.zinto.app/_integration-api/api/v1/contacts
```

The last request must be rejected. Authenticated reads require a real tenant
API key and must be tested without printing it.

## Rollback

1. Remove or move the aaPanel extension snippet out of its extension directory.
2. Run `/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf`.
3. Reload the aaPanel master with `kill -HUP $(pgrep -o nginx)`.
4. Run `docker compose -f deploy/docker-compose.preview.yml down`.

No database rollback is required because the preview applies no migration.
