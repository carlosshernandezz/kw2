import { NextRequest, NextResponse } from 'next/server';
import { decide, confirmHigh } from '@/lib/reconciliation';

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    if (body.action === 'confirm-high') {
      const n = await confirmHigh();
      return NextResponse.json({ ok: true, changed: n });
    }
    if (body.action === 'confirm' || body.action === 'reject') {
      const ids: number[] = Array.isArray(body.ids) ? body.ids.map(Number) : [];
      const adjust = body.adjust === 'date' || body.adjust === 'amount' ? body.adjust : null;
      const n = await decide(ids, body.action === 'confirm' ? 'confirmed' : 'rejected', undefined, adjust);
      return NextResponse.json({ ok: true, changed: n });
    }
    return NextResponse.json({ ok: false, error: 'accion invalida' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
