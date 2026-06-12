BEGIN;

CREATE TABLE IF NOT EXISTS clients (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  legacy_id text UNIQUE,
  name text NOT NULL,
  short_name text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'needs_review')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_aliases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id bigint REFERENCES clients(id),
  alias_type text NOT NULL
    CHECK (alias_type IN ('zelle_sender', 'zelle_recipient', 'bank_name', 'binance_name', 'email', 'phone', 'other')),
  alias_value text NOT NULL,
  normalized_value text NOT NULL,
  status text NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('suggested', 'confirmed', 'rejected', 'unidentified')),
  confidence numeric(5,4)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alias_type, normalized_value)
);

CREATE TABLE IF NOT EXISTS operators (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  legacy_id text UNIQUE,
  name text NOT NULL UNIQUE,
  medium text NOT NULL
    CHECK (medium IN ('bs', 'cash', 'zelle', 'usdt', 'expense', 'commission', 'transitory', 'other')),
  native_currency text NOT NULL,
  institution text,
  owner_name text,
  bank_fee_rate numeric(9,8)
    CHECK (bank_fee_rate IS NULL OR bank_fee_rate >= 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'needs_review')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations (
  id bigint GENERATED ALWAYS AS IDENTITY (START WITH 10000) PRIMARY KEY,
  legacy_operation_ref text,
  client_id bigint NOT NULL REFERENCES clients(id),
  operator_id bigint REFERENCES operators(id),
  operation_type text NOT NULL,
  effective_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready', 'posted', 'partially_settled', 'settled', 'needs_review', 'voided')),
  bs_rate numeric(20,8)
    CHECK (bs_rate IS NULL OR bs_rate > 0),
  external_reference text,
  notes text,
  source text NOT NULL DEFAULT 'manual',
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS obligations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id bigint NOT NULL REFERENCES operations(id),
  direction text NOT NULL
    CHECK (direction IN ('client_owes_kw2', 'kw2_owes_client')),
  original_amount_usd numeric(20,8) NOT NULL
    CHECK (original_amount_usd > 0),
  due_date date,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'partially_settled', 'settled', 'overpaid', 'needs_review', 'voided')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fund_movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id bigint REFERENCES operations(id),
  account_id bigint NOT NULL REFERENCES accounts(id),
  client_id bigint REFERENCES clients(id),
  direction text NOT NULL
    CHECK (direction IN ('inflow', 'outflow')),
  medium text NOT NULL
    CHECK (medium IN ('bs', 'cash', 'zelle', 'usdt', 'expense', 'commission', 'transitory', 'other')),
  native_currency text NOT NULL,
  native_amount numeric(24,8) NOT NULL
    CHECK (native_amount > 0),
  usd_amount numeric(20,8)
    CHECK (usd_amount IS NULL OR usd_amount > 0),
  exchange_rate numeric(20,8)
    CHECK (exchange_rate IS NULL OR exchange_rate > 0),
  effective_at timestamptz NOT NULL,
  sender_or_recipient text,
  reference text,
  status text NOT NULL DEFAULT 'posted'
    CHECK (status IN ('draft', 'posted', 'partially_reconciled', 'reconciled', 'needs_review', 'voided')),
  source text NOT NULL DEFAULT 'manual',
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS obligation_allocations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  obligation_id bigint NOT NULL REFERENCES obligations(id),
  fund_movement_id bigint NOT NULL REFERENCES fund_movements(id),
  amount_usd numeric(20,8) NOT NULL
    CHECK (amount_usd > 0),
  status text NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('suggested', 'confirmed', 'rejected', 'voided')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obligation_id, fund_movement_id)
);

CREATE TABLE IF NOT EXISTS external_transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_type text NOT NULL
    CHECK (source_type IN ('bank_statement', 'zelle_statement', 'binance_statement', 'cash_count', 'google_sheet', 'other')),
  source_account text,
  external_id text,
  effective_at timestamptz NOT NULL,
  direction text
    CHECK (direction IS NULL OR direction IN ('inflow', 'outflow')),
  native_currency text,
  native_amount numeric(24,8),
  description text,
  raw_payload jsonb NOT NULL,
  import_batch_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_account, external_id)
);

CREATE TABLE IF NOT EXISTS reconciliations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fund_movement_id bigint NOT NULL REFERENCES fund_movements(id),
  external_transaction_id bigint NOT NULL REFERENCES external_transactions(id),
  allocated_native_amount numeric(24,8) NOT NULL
    CHECK (allocated_native_amount > 0),
  status text NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested', 'confirmed', 'rejected', 'voided')),
  confidence numeric(5,4)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fund_movement_id, external_transaction_id)
);

CREATE TABLE IF NOT EXISTS daily_account_closures (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(id),
  closure_date date NOT NULL,
  system_native_balance numeric(24,8) NOT NULL,
  observed_native_balance numeric(24,8) NOT NULL,
  closing_exchange_rate numeric(20,8)
    CHECK (closing_exchange_rate IS NULL OR closing_exchange_rate > 0),
  difference_native_amount numeric(24,8) GENERATED ALWAYS AS (
    observed_native_balance - system_native_balance
  ) STORED,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'matched', 'difference_found', 'adjusted', 'approved', 'needs_review')),
  adjustment_operation_id bigint REFERENCES operations(id),
  confirmed_by text,
  confirmed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, closure_date)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_type text NOT NULL
    CHECK (actor_type IN ('user', 'agent', 'importer', 'rule', 'system')),
  actor_id text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operations_client_date
  ON operations (client_id, effective_date);
CREATE INDEX IF NOT EXISTS idx_operations_status
  ON operations (status);
CREATE INDEX IF NOT EXISTS idx_obligations_operation
  ON obligations (operation_id);
CREATE INDEX IF NOT EXISTS idx_fund_movements_account_date
  ON fund_movements (account_id, effective_at);
CREATE INDEX IF NOT EXISTS idx_fund_movements_client
  ON fund_movements (client_id);
CREATE INDEX IF NOT EXISTS idx_external_transactions_source_date
  ON external_transactions (source_type, effective_at);
CREATE INDEX IF NOT EXISTS idx_reconciliations_status
  ON reconciliations (status);
CREATE INDEX IF NOT EXISTS idx_daily_account_closures_date
  ON daily_account_closures (closure_date, status);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity
  ON audit_events (entity_type, entity_id, created_at);

CREATE OR REPLACE VIEW obligation_balances AS
SELECT
  o.id AS obligation_id,
  o.operation_id,
  op.client_id,
  o.direction,
  o.original_amount_usd,
  COALESCE(
    SUM(oa.amount_usd) FILTER (WHERE oa.status = 'confirmed'),
    0
  ) AS settled_amount_usd,
  o.original_amount_usd - COALESCE(
    SUM(oa.amount_usd) FILTER (WHERE oa.status = 'confirmed'),
    0
  ) AS balance_usd
FROM obligations o
JOIN operations op ON op.id = o.operation_id
LEFT JOIN obligation_allocations oa ON oa.obligation_id = o.id
WHERE o.status <> 'voided'
GROUP BY o.id, o.operation_id, op.client_id, o.direction, o.original_amount_usd;

CREATE OR REPLACE VIEW client_balances AS
SELECT
  c.id AS client_id,
  c.name AS client_name,
  COALESCE(
    SUM(
      CASE
        WHEN ob.direction = 'client_owes_kw2' THEN ob.balance_usd
        WHEN ob.direction = 'kw2_owes_client' THEN -ob.balance_usd
        ELSE 0
      END
    ),
    0
  ) AS balance_usd
FROM clients c
LEFT JOIN obligation_balances ob ON ob.client_id = c.id
GROUP BY c.id, c.name;

INSERT INTO schema_migrations (version)
VALUES ('002_core_model')
ON CONFLICT (version) DO NOTHING;

COMMIT;
