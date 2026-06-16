import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Corre la sincronizacion con el Sheet (scripts/kw2-sync.sh) y devuelve su salida.
export async function POST() {
  const root = path.resolve(process.cwd(), '..');
  return await new Promise<Response>((resolve) => {
    const p = spawn('bash', ['scripts/kw2-sync.sh'], { cwd: root });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('error', (e) => resolve(NextResponse.json({ ok: false, output: String(e) }, { status: 500 })));
    p.on('close', (code) => resolve(NextResponse.json({ ok: code === 0, output: out.trim() })));
  });
}
