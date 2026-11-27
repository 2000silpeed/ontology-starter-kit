-- 001_meta.sql — metadata layer: object types, properties, links, action types, logs.
-- Requires Postgres 13+ (gen_random_uuid is built in).

CREATE SCHEMA IF NOT EXISTS onto_meta;

CREATE TABLE IF NOT EXISTS onto_meta.object_type (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_name          text NOT NULL UNIQUE,          -- stable identifier used in URLs and tool names
  name              text NOT NULL,                 -- human-friendly display name, safe to change
  description       text,
  datasource_schema text NOT NULL,                 -- postgres schema holding the instance table
  datasource_table  text NOT NULL,                 -- instance table name
  title_property    text NOT NULL,                 -- api_name of the property used as display title
  edits_enabled     boolean NOT NULL DEFAULT false -- allow instance creation via POST /objects/:type
);

CREATE TABLE IF NOT EXISTS onto_meta.object_property (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type_id    uuid NOT NULL REFERENCES onto_meta.object_type(id) ON DELETE CASCADE,
  api_name          text NOT NULL,                 -- property name exposed by the API
  name              text NOT NULL,                 -- display name
  data_type         text NOT NULL,                 -- string | number | boolean | date
  required          boolean NOT NULL DEFAULT false,
  is_title          boolean NOT NULL DEFAULT false,
  datasource_column text NOT NULL,                 -- physical column on the instance table
  searchable        boolean NOT NULL DEFAULT true, -- included in /query and cross-type search
  UNIQUE (object_type_id, api_name)
);

CREATE TABLE IF NOT EXISTS onto_meta.object_link (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_name          text NOT NULL UNIQUE,          -- e.g. 'customer'
  name              text NOT NULL,                 -- e.g. 'customer'
  inverse_name      text NOT NULL,                 -- e.g. 'salesOrders'
  source_type       text NOT NULL,                 -- api_name of the object holding the FK column
  target_type       text NOT NULL,                 -- api_name of the referenced object
  cardinality       text NOT NULL DEFAULT 'N:1',   -- N:1 | 1:N | N:M (N:M needs a join table)
  datasource_column text NOT NULL                  -- FK column on the source instance table
);

CREATE TABLE IF NOT EXISTS onto_meta.action_type (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_name          text NOT NULL UNIQUE,          -- verb, e.g. 'deferShipment'
  name              text NOT NULL,                 -- display name
  description       text NOT NULL,                 -- what it does; agents rely on this wording
  object_type       text NOT NULL,                 -- api_name of the object it acts on
  parameter_schema  jsonb NOT NULL,                -- JSON Schema for the request body
  allowed_callers   text[]                         -- NULL = unrestricted; otherwise exact caller ids
);

CREATE TABLE IF NOT EXISTS onto_meta.audit_log (
  id          bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  caller      text NOT NULL,
  action_name text NOT NULL,
  target_type text NOT NULL,
  target_id   text NOT NULL,
  params      jsonb,
  outcome     text NOT NULL CHECK (outcome IN ('ok', 'error'))
);

CREATE TABLE IF NOT EXISTS onto_meta.access_log (
  id          bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  caller      text,
  action_name text NOT NULL,
  decision    text NOT NULL CHECK (decision IN ('allowed', 'denied')),
  reason      text
);

CREATE INDEX IF NOT EXISTS idx_audit_target ON onto_meta.audit_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON onto_meta.audit_log (action_name, occurred_at);
