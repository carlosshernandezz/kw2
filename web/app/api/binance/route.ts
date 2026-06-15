import { NextResponse } from 'next/server';
import { summary, listSuggestions } from '@/lib/reconciliation';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [s, suggestions] = await Promise.all([summary(), listSuggestions(false)]);
  return NextResponse.json({ summary: s, suggestions });
}
