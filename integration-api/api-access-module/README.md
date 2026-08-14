# API Access Module

This isolated TypeScript module is the maintainable source for API-key permission selection. It is intentionally independent from the compiled CRM bundle and from the current `src/` runtime.

It provides:

- A typed permission catalog with groups, labels, descriptions, and write-risk metadata.
- Named profiles for messaging, CRM read-only, SmartBC CRM, and full CRM access.
- Strict resolution of exactly one selection: `permissions` or `profile`.
- Unknown-value rejection, trimming, deduplication, and deterministic alphabetical sorting.
- A structured `PermissionValidationError` suitable for mapping to HTTP 400 responses.

Example:

```ts
resolvePermissionSelection({ profile: "smartbc_crm" });
resolvePermissionSelection({ permissions: ["messages:send", "channels:read"] });
```

The module does not decide whether an API key is allowed to write in production. Scopes and the operational write allowlist are separate controls and must remain separate when the backend adapter is added.

