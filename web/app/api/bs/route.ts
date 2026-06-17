import { NextResponse } from 'next/server';
import { ambiguousIdentities, bsSuggestions, bsSummary } from '@/lib/bs-reconciliation';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [summary, suggestions, ambiguous] = await Promise.all([bsSummary(), bsSuggestions(), ambiguousIdentities()]);
  return NextResponse.json({ summary, suggestions, ambiguous });
}
