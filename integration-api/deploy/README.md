# Preview deployment on crm.zinto.app

This deployment is intentionally read-only. It does not apply
`migrations/001_integration_api.sql`, start the webhook worker, or permit HTTP
mutations through Nginx.

## Topology

- Existing CRM remains on `127.0.0.1:3001` and is not replaced.
- Existing webhook route remains on `127.0.0.1:4001`.
- Integration API binds only to `127.0.0.1:3100`.
- Nginx exposes it at `https://crm.zinto.app/_integration-api/`.
- The container joins the existing external network
  `powerchat-shared-network` for PostgreSQL access.

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

1. Restore the timestamped Nginx site backup.
2. Run `nginx -t` and reload Nginx.
3. Run `docker compose -f deploy/docker-compose.preview.yml down`.

No database rollback is required because the preview applies no migration.

