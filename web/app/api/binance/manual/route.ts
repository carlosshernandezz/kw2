import { NextRequest, NextResponse } from 'next/server';
import { unmatchedLedger, unmatchedStatement, manualMatch, markLedgerNoCounterpart, markStatementMissingInSheet, undoReconciliation } from '@/lib/manual';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [ledger, statement] = await Promise.all([unmatchedLedger(), unmatchedStatement()]);
  return NextResponse.json({ ledger, statement });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const ledgerIds: number[] = Array.isArray(body.ledgerIds) ? body.ledgerIds.map(Number) : [];
  const stmtIds: number[] = Array.isArray(body.stmtIds) ? body.stmtIds.map(Number) : [];
  try {
    if (body.action === 'match') {
      const r = await manualMatch(ledgerIds, stmtIds, { adjustAmount: body.adjustAmount === true });
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    if (body.action === 'mark-ledger-no-counterpart') {
      const n = await markLedgerNoCounterpart(ledgerIds);
      return NextResponse.json({ ok: true, changed: n });
    }
    if (body.action === 'mark-statement-missing') {
      const n = await markStatementMissingInSheet(stmtIds);
      return NextResponse.json({ ok: true, changed: n });
    }
    if (body.action === 'undo') {
      const n = await undoReconciliation(Number(body.fundMovementId));
      return NextResponse.json({ ok: true, changed: n });
    }
    return NextResponse.json({ ok: false, error: 'accion invalida' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
