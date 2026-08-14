import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration003 = readFileSync(resolve(process.cwd(), "migrations/003_bidirectional_events_outbox.sql"), "utf8");
const migration004 = readFileSync(resolve(process.cwd(), "migrations/004_task_outbox_events.sql"), "utf8");
const migration006 = readFileSync(resolve(process.cwd(), "migrations/006_remove_legacy_task_trigger.sql"), "utf8");

describe("task outbox migrations", () => {
  it("leave one canonical trigger on contact_tasks after 004 is applied", () => {
    expect(migration003).toContain("CREATE TRIGGER integration_api_tasks_outbox");
    expect(migration004).toContain("DROP TRIGGER IF EXISTS integration_api_tasks_outbox ON contact_tasks;");
    expect(migration004).toContain("DROP TRIGGER IF EXISTS integration_api_contact_tasks_outbox ON contact_tasks;");
    expect(migration004).toContain("CREATE TRIGGER integration_api_tasks_outbox");
    expect(migration004).not.toContain("CREATE TRIGGER integration_api_contact_tasks_outbox");
  });

  it("uses the shared enqueue function for schema, origin, and deduplication handling", () => {
    expect(migration004).toContain("PERFORM integration_api_enqueue_event(event_company_id, event_type, 'task', task_row.id,");
    expect(migration004).not.toContain("INSERT INTO integration_api_outbox");
  });

  it("provides an idempotent production cleanup for the legacy trigger", () => {
    expect(migration006).toContain("DROP TRIGGER IF EXISTS integration_api_contact_tasks_outbox ON contact_tasks");
    expect(migration006).toContain("CREATE TRIGGER integration_api_tasks_outbox");
    expect(migration006).toContain("BEGIN;");
    expect(migration006).toContain("COMMIT;");
  });
});
