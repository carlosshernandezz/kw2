import { reconciledLedger, unmatchedLedger, unmatchedStatement, marks, needsReview } from '@/lib/manual';
import EstadoClient from './ui';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [reconciled, pendingLedger, pendingStatement, discrepancies, review] = await Promise.all([
    reconciledLedger(), unmatchedLedger(), unmatchedStatement(), marks(), needsReview(),
  ]);
  return (
    <EstadoClient
      reconciled={reconciled}
      pendingLedger={pendingLedger}
      pendingStatement={pendingStatement}
      discrepancies={discrepancies}
      review={review}
    />
  );
}
