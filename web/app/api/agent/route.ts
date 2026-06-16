import { NextRequest, NextResponse } from 'next/server';
import { askAgent, askReasoning } from '@/lib/agent';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { question, mode } = await req.json();
  if (!question || typeof question !== 'string') {
    return NextResponse.json({ ok: false, error: 'falta la pregunta' }, { status: 400 });
  }
  try {
    const r = mode === 'reasoning' ? await askReasoning(question) : await askAgent(question);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
