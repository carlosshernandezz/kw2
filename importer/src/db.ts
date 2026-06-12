import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Carga el .env de la raiz del repo sin depender del directorio actual.
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env'),
});

export function dbClient() {
  return new pg.Client({
    host: '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? 'kw2',
    user: process.env.POSTGRES_USER ?? 'kw2_app',
    password: process.env.POSTGRES_PASSWORD,
  });
}
