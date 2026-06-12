// Paso 1 (solo lectura): inspecciona la hoja DATA y muestra su estructura
// real para validarla antes de escribir cualquier importador.
import { sheetsClient, SHEET_ID, readRange } from './sheets.js';

async function main() {
  const sheets = sheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const titles = (meta.data.sheets ?? []).map((s) => s.properties?.title);
  console.log(`Hojas (${titles.length}):`, titles.join(' | '));

  const rows = await readRange("'DATA'!A1:Z30");
  console.log(`\nDATA — primeras ${rows.length} filas:`);
  for (const [i, row] of rows.entries()) {
    console.log(String(i + 1).padStart(3), JSON.stringify(row));
  }
}

main().catch((err) => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
