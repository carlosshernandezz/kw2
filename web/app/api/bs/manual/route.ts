import { NextRequest, NextResponse } from 'next/server';
import { manualMatchBs, unmatchedBsLedger, unmatchedBsStatement } from '@/lib/bs-manual';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [ledger, statement] = await Promise.all([unmatchedBsLedger(), unmatchedBsStatement()]);
  return NextResponse.json({ ledger, statement });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.action !== 'match') throw new Error('Acción inválida.');
    const result = await manualMatchBs(
      Array.isArray(body.ledgerIds) ? body.ledgerIds.map(Number) : [],
      Array.isArray(body.statementIds) ? body.statementIds.map(Number) : [],
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
}
