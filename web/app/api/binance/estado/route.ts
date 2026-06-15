import { NextResponse } from 'next/server';
import { reconciledLedger, unmatchedLedger, unmatchedStatement, marks } from '@/lib/manual';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [reconciled, pendingLedger, pendingStatement, discrepancies] = await Promise.all([
    reconciledLedger(), unmatchedLedger(), unmatchedStatement(), marks(),
  ]);
  return NextResponse.json({ reconciled, pendingLedger, pendingStatement, discrepancies });
}
