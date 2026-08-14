BEGIN;

CREATE TABLE IF NOT EXISTS integration_api_event_catalog (
  event_type TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO integration_api_event_catalog (event_type, schema_version) VALUES
  ('contact.created', 1),
  ('contact.updated', 1),
  ('contact.deleted', 1),
  ('conversation.created', 1),
  ('conversation.updated', 1),
  ('message.created', 1),
  ('message.status.updated', 1),
  ('note.created', 1),
  ('note.updated', 1),
  ('note.deleted', 1),
  ('tag.attached', 1),
  ('tag.detached', 1),
  ('deal.created', 1),
  ('deal.updated', 1),
  ('deal.stage.changed', 1),
  ('deal.deleted', 1),
  ('pipeline.created', 1),
  ('pipeline.updated', 1),
  ('pipeline.deleted', 1),
  ('pipeline.stage.created', 1),
  ('pipeline.stage.updated', 1),
  ('pipeline.stage.deleted', 1),
  ('task.created', 1),
  ('task.updated', 1),
  ('task.completed', 1),
  ('task.deleted', 1),
  ('channel.connection.updated', 1),
  ('erp.product.created', 1),
  ('erp.product.updated', 1),
  ('erp.product.deleted', 1),
  ('erp.stock_level.created', 1),
  ('erp.stock_level.updated', 1),
  ('erp.stock_level.deleted', 1),
  ('erp.stock_movement.created', 1),
  ('erp.stock_movement.updated', 1),
  ('erp.stock_movement.deleted', 1),
  ('erp.stock_transfer.created', 1),
  ('erp.stock_transfer.updated', 1),
  ('erp.stock_transfer.deleted', 1),
  ('erp.sales_order.created', 1),
  ('erp.sales_order.updated', 1),
  ('erp.sales_order.deleted', 1),
  ('erp.supplier.created', 1),
  ('erp.supplier.updated', 1),
  ('erp.supplier.deleted', 1),
  ('erp.purchase_order.created', 1),
  ('erp.purchase_order.updated', 1),
  ('erp.purchase_order.deleted', 1),
  ('erp.invoice.created', 1),
  ('erp.invoice.updated', 1),
  ('erp.invoice.deleted', 1),
  ('erp.invoice_payment.created', 1),
  ('erp.invoice_payment.updated', 1),
  ('erp.invoice_payment.deleted', 1),
  ('flow.created', 1),
  ('flow.updated', 1),
  ('flow.deleted', 1),
  ('flow.execution.started', 1),
  ('flow.execution.updated', 1),
  ('flow.execution.completed', 1),
  ('flow.execution.failed', 1)
ON CONFLICT (event_type) DO UPDATE
SET schema_version = EXCLUDED.schema_version;

ALTER TABLE integration_api_outbox
  ADD COLUMN IF NOT EXISTS deduplication_key TEXT;

ALTER TABLE integration_api_webhook_deliveries
  ADD COLUMN IF NOT EXISTS lease_token UUID;

CREATE UNIQUE INDEX IF NOT EXISTS integration_api_outbox_company_dedup_idx
  ON integration_api_outbox(company_id, deduplication_key)
  WHERE deduplication_key IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'integration_api_outbox'::regclass
       AND conname = 'integration_api_outbox_schema_version_check'
  ) THEN
    ALTER TABLE integration_api_outbox
      ADD CONSTRAINT integration_api_outbox_schema_version_check
      CHECK (schema_version > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'integration_api_webhook_deliveries'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) = 'UNIQUE (endpoint_id, outbox_id)'
  ) THEN
    ALTER TABLE integration_api_webhook_deliveries
      ADD CONSTRAINT integration_api_webhook_deliveries_endpoint_outbox_unique
      UNIQUE (endpoint_id, outbox_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION integration_api_public_payload(row_data JSONB)
RETURNS JSONB AS $$
DECLARE
  payload JSONB := COALESCE(row_data, '{}'::jsonb) - 'company_id';
  payload_key TEXT;
BEGIN
  FOR payload_key IN SELECT jsonb_object_keys(payload)
  LOOP
    IF (payload_key = 'id' OR payload_key LIKE '%\_id' ESCAPE '\')
       AND jsonb_typeof(payload -> payload_key) = 'number' THEN
      payload := jsonb_set(payload, ARRAY[payload_key], to_jsonb(payload ->> payload_key));
    END IF;
  END LOOP;
  RETURN payload;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION integration_api_enqueue_event(
  event_company_id INTEGER,
  requested_event_type TEXT,
  requested_resource_type TEXT,
  requested_resource_id BIGINT,
  event_payload JSONB,
  requested_deduplication_key TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  catalog_schema_version INTEGER;
  emitted_event_id UUID;
  event_origin TEXT;
BEGIN
  SELECT schema_version INTO catalog_schema_version
    FROM integration_api_event_catalog
   WHERE event_type = requested_event_type;

  IF catalog_schema_version IS NULL THEN
    RAISE EXCEPTION 'Uncatalogued integration event: %', requested_event_type;
  END IF;

  event_origin := COALESCE(NULLIF(current_setting('zinto.integration_api_origin', true), ''), 'crm');

  INSERT INTO integration_api_outbox
    (company_id, event_type, resource_type, resource_id, schema_version, payload, deduplication_key)
  VALUES
    (event_company_id, requested_event_type, requested_resource_type, requested_resource_id,
     catalog_schema_version,
     COALESCE(event_payload, '{}'::jsonb) || jsonb_build_object('_meta', jsonb_build_object('origin', event_origin)),
     requested_deduplication_key)
  ON CONFLICT (company_id, deduplication_key)
    WHERE deduplication_key IS NOT NULL
  DO NOTHING
  RETURNING event_id INTO emitted_event_id;

  IF emitted_event_id IS NULL AND requested_deduplication_key IS NOT NULL THEN
    SELECT event_id INTO emitted_event_id
      FROM integration_api_outbox
     WHERE company_id = event_company_id
       AND deduplication_key = requested_deduplication_key;
  END IF;

  RETURN emitted_event_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_contact_event()
RETURNS trigger AS $$
DECLARE
  event_company_id INTEGER;
  event_type TEXT;
  row_data JSONB;
  event_payload JSONB;
  added_tag TEXT;
  removed_tag TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND to_jsonb(NEW) - 'updated_at' IS NOT DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    RETURN NEW;
  END IF;

  event_company_id := COALESCE(NEW.company_id, OLD.company_id);
  row_data := to_jsonb(COALESCE(NEW, OLD));
  event_payload := integration_api_public_payload(row_data);

  IF TG_OP = 'INSERT' THEN
    event_type := 'contact.created';
  ELSIF TG_OP = 'DELETE' THEN
    event_type := 'contact.deleted';
    event_payload := event_payload || jsonb_build_object('deleted', true);
  ELSIF NEW.is_archived AND NOT COALESCE(OLD.is_archived, false) THEN
    event_type := 'contact.deleted';
  ELSE
    event_type := 'contact.updated';
  END IF;

  PERFORM integration_api_enqueue_event(event_company_id, event_type, 'contact',
    (row_data ->> 'id')::BIGINT, event_payload);

  IF TG_OP = 'UPDATE' THEN
    FOR added_tag IN
      SELECT unnest(COALESCE(NEW.tags, '{}'))
      EXCEPT SELECT unnest(COALESCE(OLD.tags, '{}'))
    LOOP
      PERFORM integration_api_enqueue_event(event_company_id, 'tag.attached', 'contact', NEW.id,
        jsonb_build_object('contact_id', NEW.id::TEXT, 'tag', added_tag));
    END LOOP;
    FOR removed_tag IN
      SELECT unnest(COALESCE(OLD.tags, '{}'))
      EXCEPT SELECT unnest(COALESCE(NEW.tags, '{}'))
    LOOP
      PERFORM integration_api_enqueue_event(event_company_id, 'tag.detached', 'contact', NEW.id,
        jsonb_build_object('contact_id', NEW.id::TEXT, 'tag', removed_tag));
    END LOOP;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_note_event()
RETURNS trigger AS $$
DECLARE
  event_company_id INTEGER;
  row_data JSONB := to_jsonb(COALESCE(NEW, OLD));
  event_type TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND to_jsonb(NEW) - 'updated_at' IS NOT DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    RETURN NEW;
  END IF;

  SELECT contacts.company_id INTO event_company_id
    FROM contacts
   WHERE contacts.id = (row_data ->> 'contact_id')::INTEGER;
  IF event_company_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  event_type := CASE TG_OP
    WHEN 'INSERT' THEN 'note.created'
    WHEN 'UPDATE' THEN 'note.updated'
    ELSE 'note.deleted'
  END;
  PERFORM integration_api_enqueue_event(event_company_id, event_type, 'note',
    (row_data ->> 'id')::BIGINT,
    integration_api_public_payload(row_data) ||
      CASE WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', true) ELSE '{}'::jsonb END);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_conversation_event()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND to_jsonb(NEW) - 'updated_at' IS NOT DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    RETURN NEW;
  END IF;
  PERFORM integration_api_enqueue_event(NEW.company_id,
    CASE TG_OP WHEN 'INSERT' THEN 'conversation.created' ELSE 'conversation.updated' END,
    'conversation', NEW.id, integration_api_public_payload(to_jsonb(NEW)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_message_event()
RETURNS trigger AS $$
DECLARE
  event_company_id INTEGER;
BEGIN
  SELECT company_id INTO event_company_id FROM conversations WHERE id = NEW.conversation_id;
  IF event_company_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM integration_api_enqueue_event(event_company_id, 'message.created', 'message', NEW.id,
      integration_api_public_payload(to_jsonb(NEW)));
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.read_at IS DISTINCT FROM OLD.read_at THEN
    PERFORM integration_api_enqueue_event(event_company_id, 'message.status.updated', 'message', NEW.id,
      jsonb_build_object('id', NEW.id::TEXT, 'conversation_id', NEW.conversation_id::TEXT,
        'status', NEW.status, 'read_at', NEW.read_at));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_channel_event()
RETURNS trigger AS $$
BEGIN
  IF NEW.company_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  PERFORM integration_api_enqueue_event(NEW.company_id, 'channel.connection.updated', 'channel', NEW.id,
    jsonb_build_object('id', NEW.id::TEXT, 'type', NEW.channel_type,
      'name', NEW.account_name, 'status', NEW.status));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_generic_event()
RETURNS trigger AS $$
DECLARE
  row_data JSONB := to_jsonb(COALESCE(NEW, OLD));
  event_company_id INTEGER;
  event_type TEXT;
  event_payload JSONB;
BEGIN
  IF TG_OP = 'UPDATE'
     AND to_jsonb(NEW) - 'updated_at' IS NOT DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    RETURN NEW;
  END IF;

  event_company_id := NULLIF(row_data ->> 'company_id', '')::INTEGER;
  IF event_company_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  event_type := CASE TG_OP WHEN 'INSERT' THEN TG_ARGV[1] WHEN 'UPDATE' THEN TG_ARGV[2] ELSE TG_ARGV[3] END;
  event_payload := integration_api_public_payload(row_data);
  IF TG_OP = 'DELETE' THEN event_payload := event_payload || jsonb_build_object('deleted', true); END IF;

  PERFORM integration_api_enqueue_event(event_company_id, event_type, TG_ARGV[0],
    (row_data ->> 'id')::BIGINT, event_payload);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_deal_event()
RETURNS trigger AS $$
DECLARE
  row_data JSONB := to_jsonb(COALESCE(NEW, OLD));
  event_type TEXT;
  event_payload JSONB;
BEGIN
  IF TG_OP = 'UPDATE'
     AND to_jsonb(NEW) - 'updated_at' IS NOT DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    RETURN NEW;
  END IF;

  event_payload := integration_api_public_payload(row_data);
  IF TG_OP = 'INSERT' THEN
    event_type := 'deal.created';
  ELSIF TG_OP = 'DELETE' THEN
    event_type := 'deal.deleted';
    event_payload := event_payload || jsonb_build_object('deleted', true);
  ELSIF NEW.status = 'archived' AND OLD.status IS DISTINCT FROM 'archived' THEN
    event_type := 'deal.deleted';
  ELSIF NEW.stage_id IS DISTINCT FROM OLD.stage_id
     OR NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id
     OR NEW.stage IS DISTINCT FROM OLD.stage THEN
    event_type := 'deal.stage.changed';
    event_payload := event_payload || jsonb_build_object(
      'previous_stage_id', OLD.stage_id::TEXT,
      'previous_pipeline_id', OLD.pipeline_id::TEXT,
      'previous_stage', OLD.stage
    );
  ELSE
    event_type := 'deal.updated';
  END IF;

  PERFORM integration_api_enqueue_event(COALESCE(NEW.company_id, OLD.company_id), event_type,
    'deal', (row_data ->> 'id')::BIGINT, event_payload);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_task_event()
RETURNS trigger AS $$
DECLARE
  row_data JSONB := to_jsonb(COALESCE(NEW, OLD));
  event_type TEXT;
  event_payload JSONB;
BEGIN
  IF TG_OP = 'UPDATE'
     AND to_jsonb(NEW) - 'updated_at' IS NOT DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    RETURN NEW;
  END IF;

  event_payload := integration_api_public_payload(row_data);
  IF TG_OP = 'INSERT' THEN
    event_type := 'task.created';
  ELSIF TG_OP = 'DELETE' THEN
    event_type := 'task.deleted';
    event_payload := event_payload || jsonb_build_object('deleted', true);
  ELSIF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    event_type := 'task.completed';
    event_payload := event_payload || jsonb_build_object('previous_status', OLD.status);
  ELSE
    event_type := 'task.updated';
  END IF;

  PERFORM integration_api_enqueue_event(COALESCE(NEW.company_id, OLD.company_id), event_type,
    'task', (row_data ->> 'id')::BIGINT, event_payload);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_flow_event()
RETURNS trigger AS $$
DECLARE
  row_data JSONB := to_jsonb(COALESCE(NEW, OLD));
  event_type TEXT;
  flow_payload JSONB;
BEGIN
  IF TG_OP = 'UPDATE'
     AND to_jsonb(NEW) - 'updated_at' IS NOT DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    RETURN NEW;
  END IF;
  IF NULLIF(row_data ->> 'company_id', '') IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  event_type := CASE TG_OP WHEN 'INSERT' THEN 'flow.created' WHEN 'UPDATE' THEN 'flow.updated' ELSE 'flow.deleted' END;
  flow_payload := row_data - 'company_id' - 'nodes' - 'edges' - 'custom_variables';
  flow_payload := integration_api_public_payload(flow_payload);
  IF TG_OP = 'DELETE' THEN flow_payload := flow_payload || jsonb_build_object('deleted', true); END IF;
  PERFORM integration_api_enqueue_event((row_data ->> 'company_id')::INTEGER, event_type,
    'flow', (row_data ->> 'id')::BIGINT, flow_payload);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_flow_execution_event()
RETURNS trigger AS $$
DECLARE
  row_data JSONB := to_jsonb(COALESCE(NEW, OLD));
  event_type TEXT;
  flow_payload JSONB;
BEGIN
  IF TG_OP = 'UPDATE'
     AND to_jsonb(NEW) - 'updated_at' IS NOT DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    RETURN NEW;
  END IF;
  IF NEW.company_id IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    event_type := 'flow.execution.started';
  ELSIF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    event_type := 'flow.execution.completed';
  ELSIF NEW.status = 'failed' AND OLD.status IS DISTINCT FROM 'failed' THEN
    event_type := 'flow.execution.failed';
  ELSE
    event_type := 'flow.execution.updated';
  END IF;

  flow_payload := integration_api_public_payload(row_data);
  flow_payload := flow_payload - 'execution_path' - 'context_data' - 'error_message';
  PERFORM integration_api_enqueue_event(NEW.company_id, event_type, 'flow_execution', NEW.id, flow_payload);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.deals') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS integration_api_deals_outbox ON deals';
    EXECUTE 'CREATE TRIGGER integration_api_deals_outbox AFTER INSERT OR UPDATE OR DELETE ON deals FOR EACH ROW EXECUTE FUNCTION integration_api_capture_deal_event()';
  END IF;
  IF to_regclass('public.pipelines') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS integration_api_pipelines_outbox ON pipelines';
    EXECUTE 'CREATE TRIGGER integration_api_pipelines_outbox AFTER INSERT OR UPDATE OR DELETE ON pipelines FOR EACH ROW EXECUTE FUNCTION integration_api_capture_generic_event(''pipeline'', ''pipeline.created'', ''pipeline.updated'', ''pipeline.deleted'')';
  END IF;
  IF to_regclass('public.pipeline_stages') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS integration_api_pipeline_stages_outbox ON pipeline_stages';
    EXECUTE 'CREATE TRIGGER integration_api_pipeline_stages_outbox AFTER INSERT OR UPDATE OR DELETE ON pipeline_stages FOR EACH ROW EXECUTE FUNCTION integration_api_capture_generic_event(''pipeline_stage'', ''pipeline.stage.created'', ''pipeline.stage.updated'', ''pipeline.stage.deleted'')';
  END IF;
  IF to_regclass('public.contact_tasks') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS integration_api_tasks_outbox ON contact_tasks';
    EXECUTE 'CREATE TRIGGER integration_api_tasks_outbox AFTER INSERT OR UPDATE OR DELETE ON contact_tasks FOR EACH ROW EXECUTE FUNCTION integration_api_capture_task_event()';
  END IF;
  IF to_regclass('public.products') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS integration_api_products_outbox ON products';
    EXECUTE 'CREATE TRIGGER integration_api_products_outbox AFTER INSERT OR UPDATE OR DELETE ON products FOR EACH ROW EXECUTE FUNCTION integration_api_capture_generic_event(''erp_product'', ''erp.product.created'', ''erp.product.updated'', ''erp.product.deleted'')';
  END IF;
  IF to_regclass('public.stock_levels') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS integration_api_stock_levels_outbox ON stock_levels';
    EXECUTE 'CREATE TRIGGER integration_api_stock_levels_outbox AFTER INSERT OR UPDATE OR DELETE ON stock_levels FOR EACH ROW EXECUTE FUNCTION integration_api_capture_generic_event(''erp_stock_level'', ''erp.stock_level.created'', ''erp.stock_level.updated'', ''erp.stock_level.deleted'')';
  END IF;
  IF to_regclass('public.stock_movements') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS integration_api_stock_movements_outbox ON stock_movements';
    EXECUTE 'CREATE TRIGGER integration_api_stock_movements_outbox AFTER INSERT OR UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION integration_api_capture_generic_event(''erp_stock_movement'', ''erp.stock_movement.created'', ''erp.stock_movement.updated'', ''erp.stock_movement.deleted'')';
  END IF;
  IF to_regclass('public.stock_transfers') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS integration_api_stock_transfers_outbox ON stock_transfers';
    EXECUTE 'CREATE TRIGGER integration_api_stock_transfers_outbox AFTER INSERT OR UPDATE OR DELETE ON stock_transfers FOR EACH ROW EXECUTE FUNCTION integration_api_capture_generic_event(''erp_stock_transfer'', ''erp.stock_transfer.created'', ''erp.stock_transfer.updated'', ''erp.stock_transfer.deleted'')';
  END IF;
  IF to_regclass('public.sales_orders') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS integration_api_sales_orders_outbox ON sales_orders';
    EXECUTE 'CREATE TRIGGER integration_api_sales_orders_outbox AFTER INSERT OR UPDATE OR DELETE ON sales_orders FOR EACH ROW EXECUTE FUNCTION integration_api_capture_generic_event(''erp_sales_order'', ''erp.sales_order.created'', ''erp.sales_order.updated'', ''erp.sales_order.deleted'')';
  END IF;
  IF to_regclass('public.suppliers') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS integration_api_suppliers_outbox ON suppliers';
    EXECUTE 'CREATE TRIGGER integration_api_suppliers_outbox AFTER INSERT OR UPDATE OR DELETE ON suppliers FOR EACH ROW EXECUTE FUNCTION integration_api_capture_generic_event(''erp_supplier'', ''erp.supplier.created'', ''erp.supplier.updated'', ''erp.supplier.deleted'')';
  END IF;
  IF to_regclass('public.purchase_orders') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS integration_api_purchase_orders_outbox ON purchase_orders';
    EXECUTE 'CREATE TRIGGER integration_api_purchase_orders_outbox AFTER INSERT OR UPDATE OR DELETE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION integration_api_capture_generic_event(''erp_purchase_order'', ''erp.purchase_order.created'', ''erp.purchase_order.updated'', ''erp.purchase_order.deleted'')';
  END IF;
  IF to_regclass('public.invoices') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS integration_api_invoices_outbox ON invoices';
    EXECUTE 'CREATE TRIGGER integration_api_invoices_outbox AFTER INSERT OR UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION integration_api_capture_generic_event(''erp_invoice'', ''erp.invoice.created'', ''erp.invoice.updated'', ''erp.invoice.deleted'')';
  END IF;
  IF to_regclass('public.invoice_payments') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS integration_api_invoice_payments_outbox ON invoice_payments';
    EXECUTE 'CREATE TRIGGER integration_api_invoice_payments_outbox AFTER INSERT OR UPDATE OR DELETE ON invoice_payments FOR EACH ROW EXECUTE FUNCTION integration_api_capture_generic_event(''erp_invoice_payment'', ''erp.invoice_payment.created'', ''erp.invoice_payment.updated'', ''erp.invoice_payment.deleted'')';
  END IF;
  IF to_regclass('public.flows') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS integration_api_flows_outbox ON flows';
    EXECUTE 'CREATE TRIGGER integration_api_flows_outbox AFTER INSERT OR UPDATE OR DELETE ON flows FOR EACH ROW EXECUTE FUNCTION integration_api_capture_flow_event()';
  END IF;
  IF to_regclass('public.flow_executions') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS integration_api_flow_executions_outbox ON flow_executions';
    EXECUTE 'CREATE TRIGGER integration_api_flow_executions_outbox AFTER INSERT OR UPDATE ON flow_executions FOR EACH ROW EXECUTE FUNCTION integration_api_capture_flow_execution_event()';
  END IF;
END $$;

COMMIT;
