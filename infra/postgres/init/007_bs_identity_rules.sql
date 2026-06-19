BEGIN;

CREATE TABLE IF NOT EXISTS bs_identity_rules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bank text NOT NULL,
  identity_type text NOT NULL CHECK (identity_type IN ('cedula', 'descripcion')),
  identity_value text NOT NULL,
  strategy text NOT NULL CHECK (strategy IN ('preferred_client', 'bridge_account')),
  client_id bigint REFERENCES clients(id),
  require_exact_amount boolean NOT NULL DEFAULT true,
  instruction text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  reviewed_by text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank, identity_type, identity_value)
);

CREATE INDEX IF NOT EXISTS idx_bs_identity_rules_active
  ON bs_identity_rules (bank, identity_type, identity_value)
  WHERE status = 'active';

INSERT INTO schema_migrations (version)
VALUES ('007_bs_identity_rules')
ON CONFLICT (version) DO NOTHING;

COMMIT;
