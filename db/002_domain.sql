-- 002_domain.sql — example domain: a small order-to-delivery flow.
-- Swap this file for your own domain; keep instance tables in the domain schema.

CREATE SCHEMA IF NOT EXISTS onto_app;

CREATE TABLE IF NOT EXISTS onto_app.customer (
  id      text PRIMARY KEY,          -- domain id, e.g. 'CUST-001' (TEXT so business ids work as keys)
  name    text NOT NULL,
  country text,
  tier    text NOT NULL DEFAULT 'standard'
);

CREATE TABLE IF NOT EXISTS onto_app.plant (
  id     text PRIMARY KEY,           -- e.g. 'PLANT-100'
  name   text NOT NULL,
  region text
);

CREATE TABLE IF NOT EXISTS onto_app.sales_order (
  id             text PRIMARY KEY,   -- e.g. 'SO-2026-0001'
  customer_id    text NOT NULL REFERENCES onto_app.customer(id),
  status         text NOT NULL DEFAULT 'open',  -- open | confirmed | closed
  currency       text NOT NULL DEFAULT 'KRW',
  amount         numeric NOT NULL DEFAULT 0,
  ordered_at     date NOT NULL,
  requested_date date
);

CREATE TABLE IF NOT EXISTS onto_app.delivery (
  id             text PRIMARY KEY,   -- e.g. 'DEL-0001'
  sales_order_id text NOT NULL REFERENCES onto_app.sales_order(id),
  plant_id       text NOT NULL REFERENCES onto_app.plant(id),
  status         text NOT NULL DEFAULT 'planned',  -- planned | shipped | delivered | cancelled
  shipped_at     date,
  carrier        text
);

-- A first-class proposal object: an agent's *intent* to run an action,
-- waiting for a human decision before anything executes.
CREATE TABLE IF NOT EXISTS onto_app.proposal (
  id            text PRIMARY KEY,    -- e.g. 'PRP-0001'
  action_name   text NOT NULL,       -- action_type.api_name to run on approval
  target_type   text NOT NULL,       -- api_name of the object the action targets
  target_id     text NOT NULL,
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason        text NOT NULL,       -- why the agent wants this; reviewers read this first
  status        text NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  raised_by     text NOT NULL DEFAULT 'anonymous',
  decision_note text,
  decided_by    text,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
