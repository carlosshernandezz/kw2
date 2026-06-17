import { ambiguousIdentities, bsSuggestions, bsSummary } from '@/lib/bs-reconciliation';
import BsClient from './ui';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [summary, suggestions, ambiguous] = await Promise.all([bsSummary(), bsSuggestions(), ambiguousIdentities()]);
  return <BsClient initialSummary={summary} initialSuggestions={suggestions} initialAmbiguous={ambiguous} />;
}
