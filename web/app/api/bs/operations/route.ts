import { NextRequest, NextResponse } from 'next/server';
import { ambiguousIdentityOperations } from '@/lib/bs-reconciliation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const bank = params.get('bank')?.trim();
  const type = params.get('type')?.trim();
  const identity = params.get('identity')?.trim();
  const clientId = Number(params.get('clientId'));

  if (!bank || !type || !identity || !Number.isInteger(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'Parámetros incompletos' }, { status: 400 });
  }

  const operations = await ambiguousIdentityOperations(bank, type, identity, clientId);
  return NextResponse.json({ operations });
}
