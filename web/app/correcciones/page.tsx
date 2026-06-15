import { listCorrections } from '@/lib/corrections';
import CorrectionsClient from './ui';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const corrections = await listCorrections('pending');
  return <CorrectionsClient initial={corrections} />;
}
