import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

describe("preview deployment artifacts", () => {
  it("runs the production image as a non-root user", async () => {
    const dockerfile = await read("Dockerfile");

    expect(dockerfile).toContain("npm ci --omit=dev");
    expect(dockerfile).toMatch(/USER node/);
    expect(dockerfile).not.toMatch(/COPY .*\.env/);
  });

  it("stamps the built image with the commit it was produced from", async () => {
    const dockerfile = await read("Dockerfile");
    const compose = await read("deploy/docker-compose.preview.yml");

    expect(dockerfile).toContain("ARG GIT_COMMIT");
    expect(dockerfile).toContain("LABEL org.opencontainers.image.revision=$GIT_COMMIT");
    expect(dockerfile).toContain("/app/RELEASE");
    expect(compose).toContain("GIT_COMMIT: ${GIT_COMMIT:-unknown}");
  });

  it("binds only to localhost and enforces a read-only container", async () => {
    const compose = await read("deploy/docker-compose.preview.yml");

    expect(compose).toContain('"127.0.0.1:3100:3100"');
    expect(compose).toContain('READ_ONLY_MODE: "true"');
    expect(compose).toContain('WEBHOOK_WORKER_ENABLED: "false"');
    expect(compose).toContain("read_only: true");
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).toContain("cap_drop:");
    expect(compose).toContain("powerchat-shared-network");
    expect(compose).not.toMatch(/Contrasena|PASSWORD=.*[^_]$/i);
  });

  it("proxies the dedicated API prefix and leaves method authorization to Node", async () => {
    const nginx = await read("deploy/nginx-integration-api-preview.conf");

    expect(nginx).toContain("location /_integration-api/");
    expect(nginx).toContain("proxy_pass http://127.0.0.1:3100/");
    expect(nginx).not.toContain("limit_except GET HEAD OPTIONS");
  });

  it("denies the internal media prefix publicly", async () => {
    const nginx = await read("deploy/nginx-integration-api-preview.conf");

    expect(nginx).toMatch(/location \^~ \/_integration-api\/internal\/ \{\s*deny all;/);
  });

  it("documents that SmartBC write activation is separate from the read-only preview", async () => {
    const gettingStarted = await read("docs/GETTING-STARTED.md");
    const compatibility = await read("docs/SMARTBC-COMPATIBILITY.md");
    const checklist = await read("docs/SMARTBC-READINESS-CHECKLIST.md");

    expect(gettingStarted).toContain("solo lectura");
    expect(compatibility).toContain("migracion aplicada y worker habilitado");
    expect(checklist).toContain("company_id=3");
    expect(checklist).toContain("READ_ONLY_MODE=true");
    expect(checklist).toContain("WEBHOOK_WORKER_ENABLED=false");
    expect(checklist).toContain("No hay migracion down automatica");
  });
});
