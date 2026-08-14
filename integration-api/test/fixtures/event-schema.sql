CREATE TABLE companies (id INTEGER PRIMARY KEY);
CREATE TABLE users (id INTEGER PRIMARY KEY, company_id INTEGER);
CREATE TABLE api_keys (id INTEGER PRIMARY KEY);

CREATE TABLE contacts (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  avatar_url TEXT,
  company TEXT,
  tags TEXT[] DEFAULT '{}',
  source TEXT,
  notes TEXT,
  custom_fields JSONB DEFAULT '{}',
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE TABLE notes (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL,
  created_by_id INTEGER,
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE conversations (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  contact_id INTEGER,
  channel_id INTEGER,
  channel_type TEXT,
  status TEXT,
  assigned_to_user_id INTEGER,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER DEFAULT 0,
  bot_disabled BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  external_id TEXT,
  direction TEXT,
  type TEXT,
  content TEXT,
  status TEXT,
  sender_id INTEGER,
  sender_type TEXT,
  is_from_bot BOOLEAN DEFAULT FALSE,
  media_url TEXT,
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE channel_connections (
  id SERIAL PRIMARY KEY,
  company_id INTEGER,
  channel_type TEXT,
  account_name TEXT,
  status TEXT
);

CREATE TABLE pipelines (id SERIAL PRIMARY KEY, company_id INTEGER, name TEXT, updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE pipeline_stages (id SERIAL PRIMARY KEY, company_id INTEGER, pipeline_id INTEGER, name TEXT, updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE deals (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  contact_id INTEGER,
  title TEXT,
  stage_id INTEGER,
  pipeline_id INTEGER,
  stage TEXT,
  status TEXT DEFAULT 'active',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE contact_tasks (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  contact_id INTEGER,
  title TEXT,
  status TEXT DEFAULT 'not_started',
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE products (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL, name TEXT, updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE stock_levels (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL, quantity NUMERIC, updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE stock_movements (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL, quantity NUMERIC);
CREATE TABLE stock_transfers (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL, status TEXT, updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE sales_orders (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL, status TEXT, updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE suppliers (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL, name TEXT, updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE purchase_orders (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL, status TEXT, updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE invoices (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL, status TEXT, updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE invoice_payments (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL, amount NUMERIC);

CREATE TABLE flows (
  id SERIAL PRIMARY KEY,
  company_id INTEGER,
  name TEXT,
  status TEXT,
  nodes JSONB DEFAULT '[]',
  edges JSONB DEFAULT '[]',
  custom_variables JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE flow_executions (
  id SERIAL PRIMARY KEY,
  company_id INTEGER,
  flow_id INTEGER,
  execution_id TEXT,
  status TEXT,
  execution_path JSONB DEFAULT '[]',
  context_data JSONB DEFAULT '{}',
  error_message TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
