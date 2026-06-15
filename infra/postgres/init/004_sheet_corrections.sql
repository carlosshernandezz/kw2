BEGIN;

-- Cambios propuestos para aplicar a mano en el Google Sheet (de momento no se
-- escribe automaticamente). Es una lista de trabajo: el sistema propone, un
-- humano aplica en la hoja y reimporta. En el futuro, con la Sheets API
-- autorizada para escritura, esta tabla puede aplicarse automaticamente.
CREATE TABLE IF NOT EXISTS sheet_corrections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sheet text NOT NULL DEFAULT 'MOVIMIENTOS',
  source_row_number integer,
  fund_movement_id bigint REFERENCES fund_movements(id),
  reconciliation_id bigint REFERENCES reconciliations(id),
  column_name text NOT NULL,
  current_value text,
  proposed_value text,
  locator jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'dismissed')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_by text,
  applied_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Evita duplicar la misma correccion de columna para la misma fila/origen.
  UNIQUE (sheet, source_row_number, column_name, status)
);

CREATE INDEX IF NOT EXISTS idx_sheet_corrections_status
  ON sheet_corrections (status, sheet);

INSERT INTO schema_migrations (version)
VALUES ('004_sheet_corrections')
ON CONFLICT (version) DO NOTHING;

COMMIT;
