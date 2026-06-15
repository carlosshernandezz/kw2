BEGIN;

-- Ancla estable de cada movimiento del libro al kw2_id de su fila en el Sheet.
-- Permite reimportar sin perder conciliaciones (se emparejan por kw2_id, no por
-- numero de fila ni por ID interno).
ALTER TABLE fund_movements
  ADD COLUMN IF NOT EXISTS kw2_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fund_movements_kw2_id
  ON fund_movements (kw2_id) WHERE kw2_id IS NOT NULL;

INSERT INTO schema_migrations (version)
VALUES ('006_fund_movement_kw2_id')
ON CONFLICT (version) DO NOTHING;

COMMIT;
