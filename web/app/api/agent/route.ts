import { NextRequest, NextResponse } from 'next/server';
import { askAgent } from '@/lib/agent';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { question } = await req.json();
  if (!question || typeof question !== 'string') {
    return NextResponse.json({ ok: false, error: 'falta la pregunta' }, { status: 400 });
  }
  try {
    const r = await askAgent(question);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
