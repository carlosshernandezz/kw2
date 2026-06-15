import { unmatchedLedger, unmatchedStatement } from '@/lib/manual';
import ManualClient from './ui';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [ledger, statement] = await Promise.all([unmatchedLedger(), unmatchedStatement()]);
  return <ManualClient initialLedger={ledger} initialStatement={statement} />;
}
