-- Reapplyable migration for the recovered Express CRM source.
-- Do not run against production blindly: the active production schema already
-- has api_keys and must be checked with \d api_keys first.
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name VARCHAR(80) NOT NULL,
  key_hash VARCHAR(64) NOT NULL UNIQUE,
  key_prefix VARCHAR(32) NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ NULL,
  allowed_ips JSONB NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS api_keys_company_active_idx
  ON api_keys (company_id, is_active);

CREATE INDEX IF NOT EXISTS api_keys_prefix_idx
  ON api_keys (key_prefix);
