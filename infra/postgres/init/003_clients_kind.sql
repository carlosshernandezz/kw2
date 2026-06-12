BEGIN;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'client'
    CHECK (kind IN ('client', 'system'));

INSERT INTO schema_migrations (version)
VALUES ('003_clients_kind')
ON CONFLICT (version) DO NOTHING;

COMMIT;
