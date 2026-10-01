/**
 * CSV generation, parsing and download responses.
 *
 * Web APIs only (Cloudflare Workers compatible).
 *
 * Spreadsheet formula injection: a cell that starts with `= + - @ TAB CR |`
 * is executed as a formula by Excel/Sheets/LibreOffice, so `escapeCsvCell`
 * prefixes it with a single quote. Plain numbers (`-5`, `3,14`) and phone
 * numbers (`+33612345678`, `06 12 34 56 78`, `(01) 23.45`) are exempt: they
 * can only contain digits, spaces, `( ) . -` and a leading `+`, so they cannot
 * form a formula, and prefixing them would corrupt legitimate data.
 * `unescapeCsvCell` is the exact inverse, for re-importing our own exports.
 */

/** UTF-8 byte order mark, so Excel opens the file as UTF-8. */
export const CSV_BOM = '\uFEFF';

const INJECTION_START = /^[=+\-@\t\r|]/;
/**
 * One or more `'` followed by a dangerous character: either our guard or user
 * data that would look like it. Escaping adds one more `'` and unescaping
 * removes one, which keeps the round trip exact.
 */
const GUARDED_START = /^'+[=+\-@\t\r|]/;
const PLAIN_NUMBER = /^[+-]?\d+(?:[.,]\d+)?$/;
// Digits, regular and non-breaking spaces, ( ) . - and an optional leading +.
// Deliberately NOT \s: TAB / CR / LF at the start are themselves injection vectors.
const PHONE_NUMBER = /^\+?[\d \u00a0\u202f().-]+$/;
const HAS_DIGIT = /\d/;

const DELIMITERS = [',', ';', '\t'];

/**
 * @param {unknown} delimiter
 */
function assertDelimiter(delimiter) {
  if (typeof delimiter !== 'string' || delimiter.length !== 1 || '"\r\n'.includes(delimiter)) {
    throw new RangeError('CSV delimiter must be a single character other than a quote or a line break');
  }
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isPlainNumberOrPhone(text) {
  return PLAIN_NUMBER.test(text) || (PHONE_NUMBER.test(text) && HAS_DIGIT.test(text));
}

/**
 * Neutralise formula injection in a text value (see the module comment).
 * @param {string} text
 * @returns {string}
 */
function neutralise(text) {
  if (GUARDED_START.test(text)) return `'${text}`;
  if (INJECTION_START.test(text) && !isPlainNumberOrPhone(text)) return `'${text}`;
  return text;
}

/**
 * Convert any cell value to its CSV text. Numbers and bigints are emitted as-is
 * (never neutralised: a negative number is not an attack).
 * @param {unknown} value
 * @returns {string}
 */
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  return neutralise(String(value));
}

/**
 * Escape one CSV cell: formula-injection neutralisation (see the module
 * comment), then RFC 4180 quoting when the text contains the delimiter, a
 * quote, CR or LF (or always with `quoteAll`). `null`/`undefined` become an
 * empty cell, Dates become ISO strings.
 *
 * @param {unknown} value
 * @param {{ delimiter?: string, quoteAll?: boolean }} [options]
 * @returns {string}
 * @throws {RangeError} for an invalid delimiter
 */
export function escapeCsvCell(value, { delimiter = ',', quoteAll = false } = {}) {
  assertDelimiter(delimiter);
  const text = cellText(value);
  const mustQuote = quoteAll || text.includes(delimiter) || /["\r\n]/.test(text);
  return mustQuote ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Inverse of the injection guard added by `escapeCsvCell`: removes ONE leading
 * `'` when the cell is `'` characters followed by a dangerous character
 * (`= + - @ TAB CR |`).
 * `unescapeCsvCell(escapeCsvCell(s))` equals `s` for every string `s`.
 * Non-strings are returned unchanged.
 *
 * @param {string} value
 * @returns {string}
 */
export function unescapeCsvCell(value) {
  if (typeof value !== 'string') return value;
  return GUARDED_START.test(value) ? value.slice(1) : value;
}

/**
 * @typedef {string | { header: string, key?: string|number, value?: (row: any) => unknown }} CsvColumn
 * A column is a plain string (header and object key; position for array rows)
 * or `{ header, key, value }`: `key` selects the field (defaults to `header`,
 * or to the position for array rows), `value(row)` computes the cell instead.
 */

/**
 * @param {CsvColumn} column
 * @returns {string}
 */
function columnHeader(column) {
  if (typeof column === 'string') return column;
  return column.header ?? String(column.key);
}

/**
 * @param {CsvColumn} column
 * @param {any} row
 * @param {number} index - position of the column
 * @returns {unknown}
 */
function columnValue(column, row, index) {
  if (typeof column === 'object' && typeof column.value === 'function') return column.value(row);
  const isArray = Array.isArray(row);
  let key = isArray ? index : column;
  if (typeof column === 'object') key = column.key ?? (isArray ? index : column.header);
  return row !== null && typeof row === 'object' && Object.hasOwn(row, key) ? row[key] : undefined;
}

/**
 * Generate CSV text.
 *
 * `rows` is an array of arrays or of objects (own properties only).
 * - With `columns`, a header line is written and each cell is resolved per
 *   column (see `CsvColumn`).
 * - Without `columns`, object rows get a header made of the first row's keys;
 *   array rows are written as-is with no header.
 * There is no trailing line break. All cells, headers included, go through
 * `escapeCsvCell`.
 *
 * @param {Array<any[]|Record<string, unknown>>} rows
 * @param {object} [options]
 * @param {CsvColumn[]} [options.columns]
 * @param {string} [options.delimiter=','] - single character
 * @param {boolean} [options.bom=false] - prepend a UTF-8 BOM (for Excel)
 * @param {boolean} [options.quoteAll=false] - quote every cell
 * @param {string} [options.eol='\r\n']
 * @returns {string}
 */
export function generateCsv(rows, { columns, delimiter = ',', bom = false, quoteAll = false, eol = '\r\n' } = {}) {
  if (!Array.isArray(rows)) throw new TypeError('generateCsv: rows must be an array');
  const cellOptions = { delimiter, quoteAll };

  let headers = null;
  let table;
  if (columns) {
    headers = columns.map((column) => columnHeader(column));
    table = rows.map((row) => columns.map((column, i) => columnValue(column, row, i)));
  } else if (rows.length > 0 && !Array.isArray(rows[0])) {
    const keys = Object.keys(rows[0] ?? {});
    headers = keys;
    table = rows.map((row) => keys.map((key) => columnValue(key, row, 0)));
  } else {
    table = rows.map((row) => (Array.isArray(row) ? row : []));
  }

  const lines = [...(headers ? [headers] : []), ...table].map((cells) =>
    cells.map((cell) => escapeCsvCell(cell, cellOptions)).join(delimiter)
  );
  const content = lines.join(eol);
  return bom ? CSV_BOM + content : content;
}

/**
 * Detect the delimiter from the header line: whichever of `,` `;` TAB occurs
 * most outside quotes (ties and no candidate fall back to `,`).
 * @param {string} text
 * @param {number} start - index of the first character after the BOM
 * @returns {string}
 */
function detectDelimiter(text, start) {
  const counts = new Map(DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  let blankCell = true;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') inQuotes = false;
    } else if (char === '"' && blankCell) {
      inQuotes = true;
    } else if (char === '\n' || char === '\r') {
      break;
    } else if (counts.has(char)) {
      counts.set(char, counts.get(char) + 1);
      blankCell = true;
    } else if (char.trim() !== '') {
      blankCell = false;
    }
  }
  let best = ',';
  for (const [delimiter, count] of counts) {
    if (count > counts.get(best)) best = delimiter;
  }
  return best;
}

/**
 * Read a quoted cell body starting just after its opening quote. A doubled
 * quote is a literal quote; a lone quote ends the cell.
 * @param {string} text
 * @param {number} start
 * @returns {{ value: string, next: number }} the text and the index after the closing quote
 */
function readQuotedCell(text, start) {
  let value = '';
  let index = start;
  while (index < text.length) {
    if (text[index] !== '"') {
      value += text[index++];
    } else if (text[index + 1] === '"') {
      value += '"';
      index += 2;
    } else {
      return { value, next: index + 1 };
    }
  }
  return { value, next: index };
}

/**
 * Parse CSV text.
 *
 * Handles a leading BOM, LF / CRLF / CR line endings, quoted cells (embedded
 * delimiters, line breaks and `""` escapes) and the delimiters `,` `;` TAB,
 * auto-detected from the header line. Cells are trimmed (quoted ones too) and
 * blank rows are dropped. A quote only opens a quoted cell at the start of a
 * cell, so a stray quote inside unquoted text is kept literally. An
 * unterminated quote runs to the end of the input. Non-string input parses as
 * empty.
 *
 * The injection guard added by `escapeCsvCell` is NOT removed here, run cells
 * through `unescapeCsvCell` for that.
 *
 * @param {string} text
 * @returns {{ headers: string[], rows: string[][], delimiter: string }}
 */
export function parseCsv(text) {
  const source = typeof text === 'string' ? text : '';
  let index = source.startsWith(CSV_BOM) ? 1 : 0;
  const delimiter = detectDelimiter(source, index);

  const table = [];
  let row = [];
  let cell = '';
  const endCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some(Boolean)) table.push(row);
    row = [];
  };

  while (index < source.length) {
    const char = source[index];
    if (char === '"' && cell.trim() === '') {
      const quoted = readQuotedCell(source, index + 1);
      cell = quoted.value;
      index = quoted.next;
    } else if (char === delimiter) {
      endCell();
      index++;
    } else if (char === '\n' || char === '\r') {
      index += char === '\r' && source[index + 1] === '\n' ? 2 : 1;
      endRow();
    } else {
      cell += char;
      index++;
    }
  }
  endRow();

  const [headers = [], ...rows] = table;
  return { headers, rows, delimiter };
}

/**
 * Map CSV header names to column indexes through an alias table.
 * Header names are compared lower-cased and trimmed; the alias lists must be
 * lower-case. If several columns match a field the last one wins.
 *
 * @example
 * mapCsvHeaders(['Prénom', 'Mail'], { firstName: ['prénom', 'firstname'], email: ['email', 'mail'] })
 * // { firstName: 0, email: 1 }
 *
 * @param {string[]} headers
 * @param {Record<string, string[]>} aliases - field name to accepted header names
 * @returns {Record<string, number>}
 */
export function mapCsvHeaders(headers, aliases) {
  const map = {};
  for (const [i, header] of headers.entries()) {
    const name = String(header).toLowerCase().trim();
    for (const [field, names] of Object.entries(aliases)) {
      if (names.includes(name)) {
        map[field] = i;
        break;
      }
    }
  }
  return map;
}

/**
 * Header-safe download filename: control and invisible formatting characters
 * (CR/LF, bidi overrides), quotes, path separators and `;` are removed, leading
 * dots are dropped and the length is capped. Falls back to `export.csv`.
 * @param {unknown} filename
 * @returns {string}
 */
function sanitizeFilename(filename) {
  const cleaned = String(filename ?? '')
    .replaceAll(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}"\\/;]/gu, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200)
    .trim();
  return cleaned || 'export.csv';
}

/**
 * Content-Disposition for an attachment. Non-ASCII names get an ASCII
 * `filename` fallback plus an RFC 5987 `filename*` (header values must be
 * ByteStrings, so raw accents or euro signs would make `Response` throw).
 * @param {string} filename - already sanitised
 * @returns {string}
 */
function contentDisposition(filename) {
  const fallback = filename.replaceAll(/[^ -~]|%/g, '_');
  if (fallback === filename) return `attachment; filename="${fallback}"`;
  const encoded = encodeURIComponent(filename).replaceAll(
    /['()*]/g,
    (c) => `%${c.codePointAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * CSV file download response (`text/csv; charset=utf-8`, attachment). The
 * filename is sanitised so it can never inject headers or escape the quotes.
 *
 * @param {string} content
 * @param {string} filename
 * @param {Record<string, string>} [headers] - extra headers (they win over the defaults)
 * @returns {Response}
 */
export function csvResponse(content, filename, headers = {}) {
  return new Response(content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': contentDisposition(sanitizeFilename(filename)),
      ...headers
    }
  });
}
