import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { syncGoogleSheetCloud } from '@/lib/cloud-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Corre la sincronizacion local con el Sheet y devuelve su salida.
export async function POST(request: Request) {
  if (process.env.VERCEL) {
    try {
      const body = await request.json().catch(() => ({}));
      const phase = typeof body.phase === 'string' ? body.phase : 'full';
      const result = await syncGoogleSheetCloud(phase);
      return NextResponse.json(result);
    } catch (error: any) {
      return NextResponse.json({ ok: false, output: error.message ?? String(error) }, { status: 500 });
    }
  }

  const root = path.resolve(process.cwd(), '..');
  const script = path.join(root, 'scripts', 'kw2-sync.sh');

  if (!existsSync(script)) {
    return NextResponse.json(
      {
        ok: false,
        output: `No encontré el script local de sincronización: ${script}`,
      },
      { status: 500 },
    );
  }

  return await new Promise<Response>((resolve) => {
    const p = spawn('bash', [script], { cwd: root });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('error', (e) => resolve(NextResponse.json({ ok: false, output: String(e) }, { status: 500 })));
    p.on('close', (code) => resolve(NextResponse.json({ ok: code === 0, output: out.trim() })));
  });
}
