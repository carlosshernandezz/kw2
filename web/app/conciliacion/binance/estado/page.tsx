import { reconciledLedger, unmatchedLedger, unmatchedStatement, marks } from '@/lib/manual';
import EstadoClient from './ui';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [reconciled, pendingLedger, pendingStatement, discrepancies] = await Promise.all([
    reconciledLedger(), unmatchedLedger(), unmatchedStatement(), marks(),
  ]);
  return (
    <EstadoClient
      reconciled={reconciled}
      pendingLedger={pendingLedger}
      pendingStatement={pendingStatement}
      discrepancies={discrepancies}
    />
  );
}
