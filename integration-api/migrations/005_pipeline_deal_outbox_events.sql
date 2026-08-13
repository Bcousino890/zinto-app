-- Capture changes made directly by the CRM for partner synchronization.
-- Apply after 001_integration_api.sql and the multi-pipeline schema migration.
-- API transactions set zinto.integration_api_origin=api and publish their own
-- outbox row, so these triggers skip API-originated writes.

CREATE OR REPLACE FUNCTION integration_api_capture_pipeline_event()
RETURNS trigger AS $$
DECLARE
  company_id_value INTEGER;
  event_type_value TEXT;
  row_value RECORD;
BEGIN
  IF current_setting('zinto.integration_api_origin', true) = 'api' THEN RETURN COALESCE(NEW, OLD); END IF;
  company_id_value := COALESCE(NEW.company_id, OLD.company_id);
  IF company_id_value IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  row_value := COALESCE(NEW, OLD);
  event_type_value := CASE TG_OP WHEN 'INSERT' THEN 'pipeline.created' WHEN 'DELETE' THEN 'pipeline.deleted' ELSE 'pipeline.updated' END;
  INSERT INTO integration_api_outbox (company_id, event_type, resource_type, resource_id, payload)
  VALUES (company_id_value, event_type_value, 'pipeline', row_value.id,
    jsonb_build_object('id', row_value.id::text, 'company_id', company_id_value,
      'name', row_value.name, 'description', row_value.description, 'icon', row_value.icon,
      'color', row_value.color, 'is_default', row_value.is_default,
      'is_template', row_value.is_template, 'template_category', row_value.template_category,
      'order_num', row_value.order_num, 'created_at', row_value.created_at,
      'updated_at', row_value.updated_at));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_pipeline_stage_event()
RETURNS trigger AS $$
DECLARE
  company_id_value INTEGER;
  event_type_value TEXT;
  row_value RECORD;
BEGIN
  IF current_setting('zinto.integration_api_origin', true) = 'api' THEN RETURN COALESCE(NEW, OLD); END IF;
  company_id_value := COALESCE(NEW.company_id, OLD.company_id);
  IF company_id_value IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  row_value := COALESCE(NEW, OLD);
  event_type_value := CASE TG_OP WHEN 'INSERT' THEN 'pipeline_stage.created' WHEN 'DELETE' THEN 'pipeline_stage.deleted' ELSE 'pipeline_stage.updated' END;
  INSERT INTO integration_api_outbox (company_id, event_type, resource_type, resource_id, payload)
  VALUES (company_id_value, event_type_value, 'pipeline_stage', row_value.id,
    jsonb_build_object('id', row_value.id::text, 'company_id', company_id_value,
      'pipeline_id', row_value.pipeline_id::text, 'name', row_value.name,
      'color', row_value.color, 'order_num', row_value.order_num,
      'created_at', row_value.created_at, 'updated_at', row_value.updated_at));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_deal_event()
RETURNS trigger AS $$
DECLARE
  company_id_value INTEGER;
  event_type_value TEXT;
  row_value RECORD;
BEGIN
  IF current_setting('zinto.integration_api_origin', true) = 'api' THEN RETURN COALESCE(NEW, OLD); END IF;
  company_id_value := COALESCE(NEW.company_id, OLD.company_id);
  IF company_id_value IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  row_value := COALESCE(NEW, OLD);
  IF TG_OP = 'INSERT' THEN event_type_value := 'deal.created';
  ELSIF TG_OP = 'DELETE' THEN event_type_value := 'deal.deleted';
  ELSIF NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id THEN event_type_value := 'deal.pipeline.updated';
  ELSIF NEW.stage_id IS DISTINCT FROM OLD.stage_id OR NEW.stage IS DISTINCT FROM OLD.stage THEN event_type_value := 'deal.stage.updated';
  ELSE event_type_value := 'deal.updated'; END IF;
  INSERT INTO integration_api_outbox (company_id, event_type, resource_type, resource_id, payload)
  VALUES (company_id_value, event_type_value, 'deal', row_value.id,
    jsonb_build_object('id', row_value.id::text, 'company_id', company_id_value,
      'pipeline_id', row_value.pipeline_id::text, 'contact_id', row_value.contact_id::text,
      'title', row_value.title, 'stage_id', row_value.stage_id::text, 'stage', row_value.stage,
      'value', row_value.value, 'priority', row_value.priority, 'due_date', row_value.due_date,
      'assigned_to_user_id', row_value.assigned_to_user_id::text, 'description', row_value.description,
      'tags', row_value.tags, 'status', row_value.status, 'last_activity_at', row_value.last_activity_at,
      'created_at', row_value.created_at, 'updated_at', row_value.updated_at));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS integration_api_pipelines_outbox ON pipelines;
CREATE TRIGGER integration_api_pipelines_outbox AFTER INSERT OR UPDATE OR DELETE ON pipelines
FOR EACH ROW EXECUTE FUNCTION integration_api_capture_pipeline_event();
DROP TRIGGER IF EXISTS integration_api_pipeline_stages_outbox ON pipeline_stages;
CREATE TRIGGER integration_api_pipeline_stages_outbox AFTER INSERT OR UPDATE OR DELETE ON pipeline_stages
FOR EACH ROW EXECUTE FUNCTION integration_api_capture_pipeline_stage_event();
DROP TRIGGER IF EXISTS integration_api_deals_outbox ON deals;
CREATE TRIGGER integration_api_deals_outbox AFTER INSERT OR UPDATE OR DELETE ON deals
FOR EACH ROW EXECUTE FUNCTION integration_api_capture_deal_event();
