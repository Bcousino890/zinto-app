-- Capture changes made directly by the CRM for partner synchronization.
--
-- Prerequisites (apply this file only after these objects exist):
--   * integration_api_outbox from 001_integration_api.sql
--   * pipelines, pipeline_stages.pipeline_id and deals.pipeline_id from
--     112_add_multi_pipeline_support.sql
--
-- The payloads intentionally use only columns guaranteed by the base schema
-- plus migration 112. Optional later columns are not selected. API
-- transactions set zinto.integration_api_origin=api and publish their own
-- outbox row; these triggers skip those writes to prevent duplicate events.

CREATE OR REPLACE FUNCTION integration_api_capture_pipeline_event()
RETURNS trigger AS $$
DECLARE
  event_company_id INTEGER;
  event_type TEXT;
  pipeline_row RECORD;
BEGIN
  IF current_setting('zinto.integration_api_origin', true) = 'api' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  event_company_id := COALESCE(NEW.company_id, OLD.company_id);
  IF event_company_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  pipeline_row := COALESCE(NEW, OLD);
  IF TG_OP = 'INSERT' THEN event_type := 'pipeline.created';
  ELSIF TG_OP = 'DELETE' THEN event_type := 'pipeline.deleted';
  ELSE event_type := 'pipeline.updated'; END IF;
  INSERT INTO integration_api_outbox
    (company_id, event_type, resource_type, resource_id, payload)
  VALUES (event_company_id, event_type, 'pipeline', pipeline_row.id,
    jsonb_build_object(
      'id', pipeline_row.id::text, 'company_id', event_company_id,
      'name', pipeline_row.name, 'description', pipeline_row.description,
      'icon', pipeline_row.icon, 'color', pipeline_row.color,
      'is_default', pipeline_row.is_default, 'is_template', pipeline_row.is_template,
      'template_category', pipeline_row.template_category,
      'order_num', pipeline_row.order_num,
      'created_at', pipeline_row.created_at, 'updated_at', pipeline_row.updated_at));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_pipeline_stage_event()
RETURNS trigger AS $$
DECLARE
  event_company_id INTEGER;
  event_type TEXT;
  stage_row RECORD;
BEGIN
  IF current_setting('zinto.integration_api_origin', true) = 'api' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  event_company_id := COALESCE(NEW.company_id, OLD.company_id);
  IF event_company_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  stage_row := COALESCE(NEW, OLD);
  IF TG_OP = 'INSERT' THEN event_type := 'pipeline_stage.created';
  ELSIF TG_OP = 'DELETE' THEN event_type := 'pipeline_stage.deleted';
  ELSE event_type := 'pipeline_stage.updated'; END IF;
  INSERT INTO integration_api_outbox
    (company_id, event_type, resource_type, resource_id, payload)
  VALUES (event_company_id, event_type, 'pipeline_stage', stage_row.id,
    jsonb_build_object(
      'id', stage_row.id::text, 'company_id', event_company_id,
      'pipeline_id', stage_row.pipeline_id::text, 'name', stage_row.name,
      'color', stage_row.color, 'order_num', stage_row.order_num,
      'created_at', stage_row.created_at, 'updated_at', stage_row.updated_at));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_deal_event()
RETURNS trigger AS $$
DECLARE
  event_company_id INTEGER;
  event_type TEXT;
  deal_row RECORD;
BEGIN
  IF current_setting('zinto.integration_api_origin', true) = 'api' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  event_company_id := COALESCE(NEW.company_id, OLD.company_id);
  IF event_company_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  deal_row := COALESCE(NEW, OLD);
  IF TG_OP = 'INSERT' THEN event_type := 'deal.created';
  ELSIF TG_OP = 'DELETE' THEN event_type := 'deal.deleted';
  ELSIF NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id THEN event_type := 'deal.pipeline.updated';
  ELSIF NEW.stage_id IS DISTINCT FROM OLD.stage_id OR NEW.stage IS DISTINCT FROM OLD.stage THEN event_type := 'deal.stage.updated';
  ELSE event_type := 'deal.updated'; END IF;
  INSERT INTO integration_api_outbox
    (company_id, event_type, resource_type, resource_id, payload)
  VALUES (event_company_id, event_type, 'deal', deal_row.id,
    jsonb_build_object(
      'id', deal_row.id::text, 'company_id', event_company_id,
      'pipeline_id', deal_row.pipeline_id::text, 'contact_id', deal_row.contact_id::text,
      'title', deal_row.title, 'stage_id', deal_row.stage_id::text,
      'stage', deal_row.stage, 'value', deal_row.value, 'priority', deal_row.priority,
      'due_date', deal_row.due_date, 'assigned_to_user_id', deal_row.assigned_to_user_id::text,
      'description', deal_row.description, 'tags', deal_row.tags, 'status', deal_row.status,
      'last_activity_at', deal_row.last_activity_at,
      'created_at', deal_row.created_at, 'updated_at', deal_row.updated_at));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS integration_api_pipelines_outbox ON pipelines;
CREATE TRIGGER integration_api_pipelines_outbox
AFTER INSERT OR UPDATE OR DELETE ON pipelines
FOR EACH ROW EXECUTE FUNCTION integration_api_capture_pipeline_event();

DROP TRIGGER IF EXISTS integration_api_pipeline_stages_outbox ON pipeline_stages;
CREATE TRIGGER integration_api_pipeline_stages_outbox
AFTER INSERT OR UPDATE OR DELETE ON pipeline_stages
FOR EACH ROW EXECUTE FUNCTION integration_api_capture_pipeline_stage_event();

DROP TRIGGER IF EXISTS integration_api_deals_outbox ON deals;
CREATE TRIGGER integration_api_deals_outbox
AFTER INSERT OR UPDATE OR DELETE ON deals
FOR EACH ROW EXECUTE FUNCTION integration_api_capture_deal_event();
