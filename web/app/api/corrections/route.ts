import { NextRequest, NextResponse } from 'next/server';
import { listCorrections, setCorrectionStatus } from '@/lib/corrections';

export const dynamic = 'force-dynamic';

export async function GET() {
  const corrections = await listCorrections('pending');
  return NextResponse.json({ corrections });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (body.action !== 'applied' && body.action !== 'dismissed') {
    return NextResponse.json({ ok: false, error: 'accion invalida' }, { status: 400 });
  }
  const ids: number[] = Array.isArray(body.ids) ? body.ids.map(Number) : [];
  try {
    const n = await setCorrectionStatus(ids, body.action);
    return NextResponse.json({ ok: true, changed: n });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
