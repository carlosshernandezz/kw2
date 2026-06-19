import { NextRequest, NextResponse } from 'next/server';
import { saveBsIdentityRule } from '@/lib/bs-reconciliation';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await saveBsIdentityRule({
      bank: String(body.bank ?? '').trim(),
      type: String(body.type ?? '').trim(),
      identity: String(body.identity ?? '').trim(),
      strategy: body.strategy,
      clientId: Number(body.clientId),
      instruction: String(body.instruction ?? '').trim(),
      reviewedBy: String(body.reviewedBy ?? 'app_web').trim(),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
}
