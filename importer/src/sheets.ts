import { google } from 'googleapis';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const SHEET_ID =
  process.env.KW2_SHEET_ID ?? '1bVhtBhS_cEDAnET8q5t4d4tT3pDE_bvEFD0oYjWaNWo';

export function sheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? path.join(ROOT, 'google-credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Serial de Google Sheets -> fecha ISO (dias desde 1899-12-30).
export function serialToDate(serial: number): string {
  return new Date(Math.round((serial - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
}

// Lee un rango devolviendo las FORMULAS (ej. "=MOVIMIENTOS!O14596") en vez de
// los valores calculados. Sirve para saber a qué fila apunta un enlace.
export async function readRangeFormula(range: string): Promise<string[][]> {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
    valueRenderOption: 'FORMULA',
  });
  return (res.data.values ?? []) as string[][];
}

// Igual que readRange pero con fechas como numero serial (para parsearlas exacto).
export async function readRangeSerial(range: string): Promise<unknown[][]> {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  return (res.data.values ?? []) as unknown[][];
}

export async function readRange(range: string): Promise<string[][]> {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return (res.data.values ?? []) as string[][];
}
