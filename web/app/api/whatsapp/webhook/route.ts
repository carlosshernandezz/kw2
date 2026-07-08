import { NextRequest, NextResponse } from 'next/server';
import { processWebhook, verifyWebhookSignature } from '@/lib/whatsapp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');
  if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return NextResponse.json({ ok: false, error: 'verificación rechazada' }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!verifyWebhookSignature(rawBody, request.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ ok: false, error: 'firma inválida' }, { status: 401 });
  }
  try {
    const result = await processWebhook(JSON.parse(rawBody));
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    console.error('WhatsApp webhook:', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
