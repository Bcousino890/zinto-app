-- Keep partner synchronization bidirectional for tasks changed by the CRM.
-- No company_id IS NULL fallback: task ownership must always be explicit.
CREATE OR REPLACE FUNCTION integration_api_capture_task_event()
RETURNS trigger AS $$
DECLARE
  event_company_id INTEGER;
  event_type TEXT;
  task_row contact_tasks%ROWTYPE;
BEGIN
  task_row := COALESCE(NEW, OLD);
  event_company_id := task_row.company_id;
  IF event_company_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF current_setting('zinto.integration_api_origin', true) = 'api' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    event_type := 'task.created';
  ELSIF TG_OP = 'DELETE' THEN
    event_type := 'task.deleted';
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'completed' THEN
    event_type := 'task.completed';
  ELSE
    event_type := 'task.updated';
  END IF;

  INSERT INTO integration_api_outbox (company_id, event_type, resource_type, resource_id, payload)
  VALUES (event_company_id, event_type, 'task', task_row.id,
    jsonb_build_object(
      'id', task_row.id::text, 'contact_id', task_row.contact_id::text,
      'title', task_row.title, 'description', task_row.description,
      'priority', task_row.priority, 'status', task_row.status,
      'due_date', task_row.due_date, 'completed_at', task_row.completed_at,
      'assigned_to', task_row.assigned_to, 'category', task_row.category,
      'tags', task_row.tags, 'background_color', task_row.background_color,
      'created_by_user_id', task_row.created_by::text,
      'updated_by_user_id', task_row.updated_by::text,
      'created_at', task_row.created_at, 'updated_at', task_row.updated_at));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS integration_api_contact_tasks_outbox ON contact_tasks;
CREATE TRIGGER integration_api_contact_tasks_outbox
AFTER INSERT OR UPDATE OR DELETE ON contact_tasks
FOR EACH ROW EXECUTE FUNCTION integration_api_capture_task_event();
