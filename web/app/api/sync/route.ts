import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { syncGoogleSheetCloud, type CloudSyncPhase } from '@/lib/cloud-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CLOUD_PHASES = new Set<CloudSyncPhase>([
  'data',
  'movimientos-snapshot',
  'movimientos-reimport',
  'movimientos-finalize',
  'sources',
  'bs',
  'suggestions',
]);

// Corre la sincronizacion con el Sheet y devuelve su salida.
export async function POST(request: Request) {
  const hasCloudSyncConfig = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (hasCloudSyncConfig) {
    try {
      const body = await request.json().catch(() => ({}));
      if (typeof body.phase !== 'string' || !CLOUD_PHASES.has(body.phase as CloudSyncPhase)) {
        return NextResponse.json({ ok: false, output: 'Fase de sincronizacion invalida.' }, { status: 400 });
      }
      const phase = body.phase as CloudSyncPhase;
      const rawOffset = Number(body.offset);
      const rawLimit = Number(body.limit);
      const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : undefined;
      const limit = Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 750 ? rawLimit : undefined;
      const batchId = typeof body.batchId === 'string' ? body.batchId : undefined;
      const result = await syncGoogleSheetCloud(phase, { batchId, offset, limit });
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
        output: `No encontré el script local de sincronización: ${script}. Si estás en Vercel, falta GOOGLE_SERVICE_ACCOUNT_JSON.`,
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
