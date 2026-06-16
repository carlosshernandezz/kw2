/**
 * KW2 - Asignador automatico de kw2_id para la hoja MOVIMIENTOS.
 *
 * Pega este codigo en el editor de Apps Script del Sheet 2026 KW2
 * (Extensiones -> Apps Script), guarda, corre backfillKw2Ids() una vez para
 * llenar las filas existentes, e instala un disparador "On change" para
 * onChangeAssign (asi se asigna solo cada vez que agregas/eliminas filas).
 *
 * El kw2_id es un codigo opaco y estable (ej. KW2-7FH3K9Q). Se escribe una vez
 * por fila y nunca cambia aunque insertes, ordenes o borres filas. Solo se
 * escribe en la columna del encabezado 'kw2_id'; no toca ninguna otra columna.
 */

var SHEET_NAME = 'MOVIMIENTOS';
var ID_HEADER = 'kw2_id';
var DATE_COL = 1;        // columna A (Fecha) marca una fila "real"
var DEFAULT_ID_COL = 19; // columna S si la columna kw2_id aun no existe
var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos (0/O, 1/I/L)

function getIdColumn_(sheet) {
  var header = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getValues()[0];
  for (var i = 0; i < header.length; i++) {
    if (String(header[i]).trim() === ID_HEADER) return i + 1; // 1-based
  }
  sheet.getRange(1, DEFAULT_ID_COL).setValue(ID_HEADER);
  return DEFAULT_ID_COL;
}

function genCode_(used) {
  var code;
  do {
    code = 'KW2-';
    for (var i = 0; i < 7; i++) code += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
  } while (used[code]);
  used[code] = true;
  return code;
}

function assignMissingIds() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var idCol = getIdColumn_(sheet);
  var n = lastRow - 1;
  var dates = sheet.getRange(2, DATE_COL, n, 1).getValues();
  var idRange = sheet.getRange(2, idCol, n, 1);
  var ids = idRange.getValues();

  // Recorre de arriba hacia abajo. La PRIMERA fila con un codigo se lo queda;
  // una fila posterior con el MISMO codigo (ej. copiada/pegada) recibe uno
  // nuevo. Asi, al copiar una operacion vieja y pegarla como nueva, la copia
  // no duplica el codigo: se le asigna uno propio.
  var used = {};
  var changed = 0;
  for (var j = 0; j < n; j++) {
    var hasDate = dates[j][0] !== '' && dates[j][0] !== null;
    if (!hasDate) continue;
    var cur = ids[j][0];
    if (cur && !used[cur]) { used[cur] = true; }      // primera aparicion: se queda
    else { ids[j][0] = genCode_(used); changed++; }   // vacio o duplicado: codigo nuevo
  }
  if (changed > 0) idRange.setValues(ids);
  return changed;
}

/** Correr una sola vez para llenar las filas existentes. */
function backfillKw2Ids() {
  var n = assignMissingIds();
  SpreadsheetApp.getActiveSpreadsheet().toast('kw2_id asignados: ' + n, 'KW2', 5);
}

/** Disparador instalable "On change": asigna IDs al agregar/editar filas. */
function onChangeAssign(e) {
  assignMissingIds();
}
