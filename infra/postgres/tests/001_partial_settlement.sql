\set ON_ERROR_STOP on

BEGIN;

INSERT INTO clients (legacy_id, name)
VALUES ('TEST-PEDRO', 'Pedro Prueba');

INSERT INTO accounts (legacy_id, name, medium, native_currency)
VALUES
  ('TEST-ZELLE', 'ZELLE PRUEBA', 'zelle', 'USD'),
  ('TEST-CASH', 'CASH PRUEBA', 'cash', 'USD');

INSERT INTO operations (
  client_id,
  operation_type,
  effective_date,
  status,
  notes
)
SELECT
  id,
  'bs_x_pending_payment',
  DATE '2026-06-12',
  'partially_settled',
  'Prueba automatizada: KW2 entrego Bs y Pedro debe USD 1.000'
FROM clients
WHERE legacy_id = 'TEST-PEDRO';

INSERT INTO obligations (operation_id, direction, original_amount_usd)
SELECT id, 'client_owes_kw2', 1000
FROM operations
WHERE notes LIKE 'Prueba automatizada:%';

INSERT INTO fund_movements (
  operation_id,
  account_id,
  client_id,
  direction,
  medium,
  native_currency,
  native_amount,
  usd_amount,
  effective_at,
  sender_or_recipient
)
SELECT
  op.id,
  account.id,
  client.id,
  'inflow',
  payment.medium,
  'USD',
  payment.amount,
  payment.amount,
  TIMESTAMPTZ '2026-06-12 10:00:00-04',
  'Pedro'
FROM operations op
JOIN clients client ON client.id = op.client_id
CROSS JOIN (
  VALUES
    ('TEST-ZELLE'::text, 'zelle'::text, 300::numeric),
    ('TEST-CASH'::text, 'cash'::text, 200::numeric)
) AS payment(account_legacy_id, medium, amount)
JOIN accounts account ON account.legacy_id = payment.account_legacy_id
WHERE op.notes LIKE 'Prueba automatizada:%';

INSERT INTO obligation_allocations (
  obligation_id,
  fund_movement_id,
  amount_usd
)
SELECT obligation.id, movement.id, movement.usd_amount
FROM obligations obligation
JOIN operations operation ON operation.id = obligation.operation_id
JOIN fund_movements movement ON movement.operation_id = operation.id
WHERE operation.notes LIKE 'Prueba automatizada:%';

DO $$
DECLARE
  actual_balance numeric(20,8);
BEGIN
  SELECT balance_usd
  INTO actual_balance
  FROM obligation_balances
  WHERE operation_id = (
    SELECT id
    FROM operations
    WHERE notes LIKE 'Prueba automatizada:%'
  );

  IF actual_balance <> 500 THEN
    RAISE EXCEPTION
      'Saldo incorrecto. Esperado: 500. Obtenido: %',
      actual_balance;
  END IF;

  RAISE NOTICE
    'Prueba aprobada: deuda 1000 - Zelle 300 - cash 200 = saldo 500';
END
$$;

ROLLBACK;
