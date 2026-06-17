import { NextRequest, NextResponse } from 'next/server';
import { decideBs } from '@/lib/bs-reconciliation';

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (body.action !== 'confirm' && body.action !== 'reject') {
    return NextResponse.json({ ok: false, error: 'acción inválida' }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isFinite) : [];
  try {
    const result = await decideBs(ids, body.action === 'confirm' ? 'confirmed' : 'rejected');
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
