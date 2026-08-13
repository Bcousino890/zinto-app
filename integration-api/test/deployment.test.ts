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

  it("isolates the preview under a dedicated GET-only nginx prefix", async () => {
    const nginx = await read("deploy/nginx-integration-api-preview.conf");

    expect(nginx).toContain("location /_integration-api/");
    expect(nginx).toContain("limit_except GET HEAD OPTIONS");
    expect(nginx).toContain("proxy_pass http://127.0.0.1:3100/");
  });
});
