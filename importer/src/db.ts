import pg from 'pg';

export function dbClient() {
  return new pg.Client({
    host: '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? 'kw2',
    user: process.env.POSTGRES_USER ?? 'kw2_app',
    password: process.env.POSTGRES_PASSWORD,
  });
}
