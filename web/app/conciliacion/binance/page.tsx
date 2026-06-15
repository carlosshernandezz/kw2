import { summary, listSuggestions } from '@/lib/reconciliation';
import BinanceClient from './ui';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [s, suggestions] = await Promise.all([summary(), listSuggestions(false)]);
  return <BinanceClient initialSummary={s} initialSuggestions={suggestions} />;
}
