# Zinto CRM: Current Production State

**Audit date:** 13 August 2026  
**Application:** `crm.zinto.app`  
**Purpose:** Preserve verified facts about the recovered installation and avoid
confusing a deployable copy with the unavailable original source tree.

## Executive conclusion

The current Zinto installation is an operationally self-contained deployment
snapshot. It can run from the recovered Docker image, PostgreSQL data, uploads,
migrations, configuration, and persistent channel data without contacting the
original developer or a remote license server.

It is not, however, the complete original development project. The active
backend and frontend are compiled artifacts. The editable `server/`,
`client/src/`, `shared/`, original tests, source maps, and original Git history
used to produce this version were not present on the VPS or in its final Docker
image.

This distinction means:

- The current version can be preserved, restored, and operated.
- It can be inspected and patched with care, but modifying compiled output is
  not a maintainable development strategy.
- A clean, fully controlled future version requires new source code, tests,
  documentation, and build automation owned in this repository.

## Assets recovered

- Production backend bundle in `dist/index.js`.
- Production frontend build and referenced static assets in `dist/public`.
- Dockerfiles and Compose deployment configuration.
- Node package manifests and runtime dependency versions.
- PostgreSQL migrations and translation catalogs.
- PostgreSQL database backup and schema backup.
- Company settings, plans, uploads, and persistent application data backups.
- Recovery scripts and regression checks for fixes made to the compiled
  deployment.

Secrets, active session files, production `.env` files, credentials, private
keys, and customer media must not be committed to Git.

## Technical inventory

Static inspection of the active bundle found approximately:

- 696 internal and public HTTP route strings.
- More than 170 PostgreSQL application tables.
- Modules for contacts, conversations, messages, channels, notes, tags,
  pipelines, deals, tasks, campaigns, flows, scheduling, email, WhatsApp,
  Instagram, Messenger, Telegram, TikTok, voice, webchat, reporting, ERP, and
  administration.
- An initial public `/api/v1` implementation with 12 principal routes for
  channels, sending messages, conversations, contacts, media, status, health,
  and email attachments.
- Existing database foundations for API keys, usage accounting, rate limits,
  and webhook delivery.

The existing `/api/v1` is useful as a compatibility bridge, but it does not
cover the whole Zinto product and is not sufficient as the long-term public
integration contract.

## Offline restoration test

A non-production verification environment was created from the recovered
Docker images and database backup. It used an internal Docker network with no
Internet access and did not mount production WhatsApp sessions or production
uploads.

Verified results:

- PostgreSQL backup restored successfully.
- The restored data contained 12 companies, 1,161 contacts, 917 conversations,
  and 13,563 messages at the time of the backup.
- The application process remained running.
- A local public settings API request returned successfully.
- Outbound Internet access from the test application was blocked.
- The temporary environment was removed after the test.

One migration attempted to recreate an already existing foreign-key constraint
during startup. This did not prevent the tested API from starting, but migration
idempotency must be corrected in the reconstructed source before automated
disaster recovery is considered complete.

## License and updater findings

The compiled application contains support for two build modes:

- A licensed build, marked by a local `.licensed` file and validated against a
  local encrypted license containing expiration and allowed IP information.
- A regular build, where the absence of the marker disables license
  enforcement.

The active production image and the isolated restore contained neither a
`.licensed` marker nor a license file. Static inspection confirms that this is
treated as a regular build, so the running application is not dependent on a
remote licensing service.

The bundle also contains a manual updater configured for a PowerChat release
domain. Update checks and installation require a super-administrator action;
they are not automatically executed during normal startup. Zinto must not use
this updater going forward. All future releases should be produced from this
repository by Zinto-controlled CI/CD.

## External services

Operational independence from the original developer does not mean the product
has no external dependencies. Optional or channel-specific functions can depend
on provider accounts such as Meta/WhatsApp, Twilio, Telnyx, Telegram, TikTok,
Google, OpenAI, payment processors, email providers, and DNS/hosting services.

To preserve business independence, each provider account, recovery email,
billing account, OAuth application, DNS zone, and API credential must be owned
and administered by Zinto or its operating company.

## Security observations

The audit found that SSH password authentication is enabled. Server access must
be hardened separately by rotating credentials, reviewing privileged users,
installing company-controlled SSH keys, disabling unused accounts, and then
disabling password-based SSH access. These actions must be performed with a
tested recovery path to prevent lockout.

No credentials or access-source details are recorded in this repository.

## Reconstruction strategy

Zinto will retain the current compiled deployment as a compatibility reference
while creating maintainable components in source form. The first component is a
standalone Integration API that:

1. Defines a stable API contract owned by Zinto.
2. Reuses the current message delivery engine through a controlled adapter.
3. Reads and writes the existing PostgreSQL model with explicit tenant checks.
4. Captures changes made by either Zinto or external systems in an outbox.
5. Delivers signed, retryable webhooks for bidirectional synchronization.
6. Is covered by automated tests and generated OpenAPI documentation.

Modules can subsequently be reconstructed behind the same public contract,
allowing the compiled monolith to be replaced without forcing customer
integrations to change.

## Meaning of "fully controlled"

The technical target is reached when all of the following are true:

- Every Zinto-owned component has editable source, tests, and build scripts.
- Production can be rebuilt from Git and documented external dependencies.
- A restore test succeeds on a clean server.
- Zinto controls all infrastructure and provider accounts.
- No update, license, or authentication mechanism depends on the original
  developer.
- The compiled legacy bundle is no longer required for normal operation.

Legal ownership of the legacy program is a contractual question and is not
established by this technical document.
