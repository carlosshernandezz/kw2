BEGIN;

-- Marcas de discrepancia decididas por un humano durante la conciliacion:
--  - 'no_statement_counterpart': un movimiento del libro NO esta en el estado
--    de cuenta (ej. BitHash 200 mal registrado).
--  - 'missing_in_sheet': una fila del estado de cuenta NO esta en MOVIMIENTOS
--    y hay que agregarla (ej. el Send de Jochiwi).
CREATE TABLE IF NOT EXISTS reconciliation_marks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type text NOT NULL
    CHECK (entity_type IN ('fund_movement', 'external_transaction')),
  entity_id bigint NOT NULL,
  mark text NOT NULL
    CHECK (mark IN ('no_statement_counterpart', 'missing_in_sheet')),
  note text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'undone')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Una sola marca activa por entidad.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reconciliation_marks_active
  ON reconciliation_marks (entity_type, entity_id) WHERE status = 'active';

-- Tipo de correccion para la hoja: cambio de valor, agregar fila o dividir fila.
ALTER TABLE sheet_corrections
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'update'
    CHECK (kind IN ('update', 'add_row', 'split'));

INSERT INTO schema_migrations (version)
VALUES ('005_manual_reconciliation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
