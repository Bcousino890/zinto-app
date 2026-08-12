# Zinto CRM

Recovered deployment snapshot of the application running at `crm.zinto.app` on 13 August 2026.

## What is included

- The production backend bundle in `dist/index.js`.
- The production frontend assets in `dist/public`.
- Database migrations, translations, package manifests, and Docker deployment files.
- The deployed fixes for conversation history, duplicate empty conversations, contact profile photos, multimedia uploads, and Zinto startup branding.
- Recovery patch scripts and regression checks in `recovery-tools`.

## Source availability

The VPS and its Docker image do not contain the original `client`, `server`, or `shared` TypeScript/React source directories, and the production assets do not include source maps. This repository therefore preserves the complete deployable application recovered from production, not the unavailable pre-build source tree.

Only the 79 frontend assets reachable from the production `index.html` and its import graph are tracked. A further 1,321 obsolete hashed assets from earlier deployments were deliberately excluded.

## Local deployment

1. Copy `.env.example` to `.env` and replace every placeholder secret.
2. Run `docker compose up --build -d`.
3. Open `http://localhost:9000`, or the port configured in `.env`.

Never commit `.env`, customer uploads, WhatsApp sessions, database volumes, certificates, or instance-specific configuration.
