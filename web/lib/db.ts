import { Pool } from 'pg';
import path from 'node:path';
import { config } from 'dotenv';

// Lee el .env de la raiz del repo (un nivel arriba de web/).
config({ path: path.resolve(process.cwd(), '..', '.env') });

declare global {
  // eslint-disable-next-line no-var
  var _kw2Pool: Pool | undefined;
}

export const pool =
  global._kw2Pool ??
  new Pool({
    host: '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? 'kw2',
    user: process.env.POSTGRES_USER ?? 'kw2_app',
    password: process.env.POSTGRES_PASSWORD,
    max: 5,
  });

if (process.env.NODE_ENV !== 'production') global._kw2Pool = pool;

export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
