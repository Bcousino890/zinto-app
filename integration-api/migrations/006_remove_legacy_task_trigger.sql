-- Remove the legacy task trigger left by the original 004 migration.
-- The canonical trigger and capture function are already installed by 003/004.
-- This migration is idempotent and does not touch task or outbox data.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.contact_tasks') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS integration_api_contact_tasks_outbox ON contact_tasks';
    EXECUTE 'DROP TRIGGER IF EXISTS integration_api_tasks_outbox ON contact_tasks';
    EXECUTE 'CREATE TRIGGER integration_api_tasks_outbox
      AFTER INSERT OR UPDATE OR DELETE ON contact_tasks
      FOR EACH ROW EXECUTE FUNCTION integration_api_capture_task_event()';
  END IF;
END $$;

COMMIT;
