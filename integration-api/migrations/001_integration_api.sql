BEGIN;

CREATE TABLE IF NOT EXISTS integration_api_idempotency (
  id BIGSERIAL PRIMARY KEY,
  api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  UNIQUE (api_key_id, method, path, idempotency_key)
);

CREATE TABLE IF NOT EXISTS integration_api_audit_records (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id BIGINT,
  old_values JSONB,
  new_values JSONB,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_api_outbox (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id BIGINT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS integration_api_webhook_endpoints (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  encrypted_secret TEXT NOT NULL,
  event_types TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_api_webhook_deliveries (
  id BIGSERIAL PRIMARY KEY,
  endpoint_id BIGINT NOT NULL REFERENCES integration_api_webhook_endpoints(id) ON DELETE CASCADE,
  outbox_id BIGINT NOT NULL REFERENCES integration_api_outbox(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'leased', 'delivered', 'retrying', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ,
  response_status INTEGER,
  error_message TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (endpoint_id, outbox_id)
);

CREATE INDEX IF NOT EXISTS integration_api_idempotency_expiry_idx
  ON integration_api_idempotency(expires_at);
CREATE INDEX IF NOT EXISTS integration_api_audit_company_created_idx
  ON integration_api_audit_records(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS integration_api_outbox_pending_idx
  ON integration_api_outbox(available_at, id) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS integration_api_delivery_pending_idx
  ON integration_api_webhook_deliveries(next_attempt_at, id)
  WHERE status IN ('pending', 'retrying');

CREATE OR REPLACE FUNCTION integration_api_capture_contact_event()
RETURNS trigger AS $$
DECLARE
  event_company_id INTEGER;
  added_tag TEXT;
  removed_tag TEXT;
BEGIN
  IF current_setting('zinto.integration_api_origin', true) = 'api' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  event_company_id := COALESCE(NEW.company_id, OLD.company_id);
  IF event_company_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO integration_api_outbox (company_id, event_type, resource_type, resource_id, payload)
    VALUES (event_company_id, 'contact.created', 'contact', NEW.id,
      jsonb_build_object('id', NEW.id::text, 'name', NEW.name, 'email', NEW.email,
        'phone', NEW.phone, 'avatar_url', NEW.avatar_url, 'company', NEW.company,
        'tags', COALESCE(to_jsonb(NEW.tags), '[]'::jsonb), 'source', NEW.source,
        'notes', NEW.notes, 'custom_fields', NEW.custom_fields,
        'archived', NEW.is_archived, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO integration_api_outbox (company_id, event_type, resource_type, resource_id, payload)
    VALUES (event_company_id, 'contact.deleted', 'contact', OLD.id,
      jsonb_build_object('id', OLD.id::text, 'deleted', true));
  ELSE
    INSERT INTO integration_api_outbox (company_id, event_type, resource_type, resource_id, payload)
    VALUES (event_company_id,
      CASE WHEN NEW.is_archived AND NOT OLD.is_archived THEN 'contact.deleted' ELSE 'contact.updated' END,
      'contact', NEW.id,
      jsonb_build_object('id', NEW.id::text, 'name', NEW.name, 'email', NEW.email,
        'phone', NEW.phone, 'avatar_url', NEW.avatar_url, 'company', NEW.company,
        'tags', COALESCE(to_jsonb(NEW.tags), '[]'::jsonb), 'source', NEW.source,
        'notes', NEW.notes, 'custom_fields', NEW.custom_fields,
        'archived', NEW.is_archived, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at));

    FOR added_tag IN
      SELECT unnest(COALESCE(NEW.tags, '{}'))
      EXCEPT SELECT unnest(COALESCE(OLD.tags, '{}'))
    LOOP
      INSERT INTO integration_api_outbox (company_id, event_type, resource_type, resource_id, payload)
      VALUES (event_company_id, 'tag.attached', 'contact', NEW.id,
        jsonb_build_object('contact_id', NEW.id::text, 'tag', added_tag));
    END LOOP;
    FOR removed_tag IN
      SELECT unnest(COALESCE(OLD.tags, '{}'))
      EXCEPT SELECT unnest(COALESCE(NEW.tags, '{}'))
    LOOP
      INSERT INTO integration_api_outbox (company_id, event_type, resource_type, resource_id, payload)
      VALUES (event_company_id, 'tag.detached', 'contact', NEW.id,
        jsonb_build_object('contact_id', NEW.id::text, 'tag', removed_tag));
    END LOOP;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_note_event()
RETURNS trigger AS $$
DECLARE
  event_company_id INTEGER;
  note_row notes%ROWTYPE;
BEGIN
  IF current_setting('zinto.integration_api_origin', true) = 'api' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  note_row := COALESCE(NEW, OLD);
  SELECT company_id INTO event_company_id FROM contacts WHERE id = note_row.contact_id;
  IF event_company_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  INSERT INTO integration_api_outbox (company_id, event_type, resource_type, resource_id, payload)
  VALUES (event_company_id,
    CASE TG_OP WHEN 'INSERT' THEN 'note.created' WHEN 'UPDATE' THEN 'note.updated' ELSE 'note.deleted' END,
    'note', note_row.id,
    jsonb_build_object('id', note_row.id::text, 'contact_id', note_row.contact_id::text,
      'created_by_id', note_row.created_by_id::text, 'content', note_row.content,
      'created_at', note_row.created_at, 'updated_at', note_row.updated_at));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_conversation_event()
RETURNS trigger AS $$
BEGIN
  IF current_setting('zinto.integration_api_origin', true) = 'api' THEN RETURN NEW; END IF;
  IF NEW.company_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO integration_api_outbox (company_id, event_type, resource_type, resource_id, payload)
  VALUES (NEW.company_id, CASE TG_OP WHEN 'INSERT' THEN 'conversation.created' ELSE 'conversation.updated' END,
    'conversation', NEW.id,
    jsonb_build_object('id', NEW.id::text, 'contact_id', NEW.contact_id::text,
      'channel_id', NEW.channel_id::text, 'channel_type', NEW.channel_type,
      'status', NEW.status, 'assigned_to_user_id', NEW.assigned_to_user_id,
      'last_message_at', NEW.last_message_at, 'unread_count', NEW.unread_count,
      'bot_disabled', NEW.bot_disabled, 'archived', NEW.is_archived,
      'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_message_event()
RETURNS trigger AS $$
DECLARE
  event_company_id INTEGER;
BEGIN
  IF current_setting('zinto.integration_api_origin', true) = 'api' THEN RETURN NEW; END IF;
  SELECT company_id INTO event_company_id FROM conversations WHERE id = NEW.conversation_id;
  IF event_company_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO integration_api_outbox (company_id, event_type, resource_type, resource_id, payload)
    VALUES (event_company_id, 'message.created', 'message', NEW.id,
      jsonb_build_object('id', NEW.id::text, 'conversation_id', NEW.conversation_id::text,
        'external_id', NEW.external_id, 'direction', NEW.direction, 'type', NEW.type,
        'content', NEW.content, 'status', NEW.status, 'sender_id', NEW.sender_id,
        'sender_type', NEW.sender_type, 'from_bot', NEW.is_from_bot,
        'media_url', NEW.media_url, 'sent_at', NEW.sent_at, 'read_at', NEW.read_at,
        'created_at', NEW.created_at));
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.read_at IS DISTINCT FROM OLD.read_at THEN
    INSERT INTO integration_api_outbox (company_id, event_type, resource_type, resource_id, payload)
    VALUES (event_company_id, 'message.status.updated', 'message', NEW.id,
      jsonb_build_object('id', NEW.id::text, 'conversation_id', NEW.conversation_id::text,
        'status', NEW.status, 'read_at', NEW.read_at));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION integration_api_capture_channel_event()
RETURNS trigger AS $$
BEGIN
  IF current_setting('zinto.integration_api_origin', true) = 'api' THEN RETURN NEW; END IF;
  IF NEW.company_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  INSERT INTO integration_api_outbox (company_id, event_type, resource_type, resource_id, payload)
  VALUES (NEW.company_id, 'channel.connection.updated', 'channel', NEW.id,
    jsonb_build_object('id', NEW.id::text, 'type', NEW.channel_type,
      'name', NEW.account_name, 'status', NEW.status));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS integration_api_contacts_outbox ON contacts;
CREATE TRIGGER integration_api_contacts_outbox
AFTER INSERT OR UPDATE OR DELETE ON contacts
FOR EACH ROW EXECUTE FUNCTION integration_api_capture_contact_event();

DROP TRIGGER IF EXISTS integration_api_notes_outbox ON notes;
CREATE TRIGGER integration_api_notes_outbox
AFTER INSERT OR UPDATE OR DELETE ON notes
FOR EACH ROW EXECUTE FUNCTION integration_api_capture_note_event();

DROP TRIGGER IF EXISTS integration_api_conversations_outbox ON conversations;
CREATE TRIGGER integration_api_conversations_outbox
AFTER INSERT OR UPDATE ON conversations
FOR EACH ROW EXECUTE FUNCTION integration_api_capture_conversation_event();

DROP TRIGGER IF EXISTS integration_api_messages_outbox ON messages;
CREATE TRIGGER integration_api_messages_outbox
AFTER INSERT OR UPDATE OF status, read_at ON messages
FOR EACH ROW EXECUTE FUNCTION integration_api_capture_message_event();

DROP TRIGGER IF EXISTS integration_api_channels_outbox ON channel_connections;
CREATE TRIGGER integration_api_channels_outbox
AFTER UPDATE OF status ON channel_connections
FOR EACH ROW EXECUTE FUNCTION integration_api_capture_channel_event();

COMMIT;
