import { unmatchedBsLedger, unmatchedBsStatement } from '@/lib/bs-manual';
import BsPendingClient from './ui';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [ledger, statement] = await Promise.all([unmatchedBsLedger(), unmatchedBsStatement()]);
  return <BsPendingClient initialLedger={ledger} initialStatement={statement} />;
}
