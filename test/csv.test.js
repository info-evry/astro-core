import { describe, it, expect } from 'vitest';
import {
  CSV_BOM,
  escapeCsvCell,
  unescapeCsvCell,
  generateCsv,
  parseCsv,
  mapCsvHeaders,
  csvResponse
} from '../src/lib/csv.js';

/** True when the (possibly quoted) escaped cell carries the formula guard. */
const isGuarded = (escaped) => escaped.replace(/^"/, '').startsWith("'");

describe('escapeCsvCell: values', () => {
  it('handles null, undefined, numbers, booleans, bigint, dates', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
    expect(escapeCsvCell(0)).toBe('0');
    expect(escapeCsvCell(-5)).toBe('-5');
    expect(escapeCsvCell(-1e-7)).toBe('-1e-7');
    expect(escapeCsvCell(3.14)).toBe('3.14');
    expect(escapeCsvCell(12n)).toBe('12');
    expect(escapeCsvCell(true)).toBe('true');
    expect(escapeCsvCell(new Date('2025-01-02T03:04:05Z'))).toBe('2025-01-02T03:04:05.000Z');
    expect(escapeCsvCell(new Date('nope'))).toBe('');
  });

  it('stringifies objects through toString (and still guards them)', () => {
    expect(escapeCsvCell({ toString: () => 'obj' })).toBe('obj');
    expect(escapeCsvCell({ toString: () => '=evil()' })).toBe("'=evil()");
    expect(escapeCsvCell(['a', 'b'])).toBe('"a,b"');
  });
});

describe('escapeCsvCell: quoting', () => {
  it('quotes cells containing the delimiter, quotes, CR or LF', () => {
    expect(escapeCsvCell('plain')).toBe('plain');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('l1\nl2')).toBe('"l1\nl2"');
    expect(escapeCsvCell('l1\r\nl2')).toBe('"l1\r\nl2"');
  });

  it('quotes only on the active delimiter', () => {
    expect(escapeCsvCell('a;b')).toBe('a;b');
    expect(escapeCsvCell('a;b', { delimiter: ';' })).toBe('"a;b"');
    expect(escapeCsvCell('a,b', { delimiter: ';' })).toBe('a,b');
    expect(escapeCsvCell('a\tb', { delimiter: '\t' })).toBe('"a\tb"');
  });

  it('quotes everything with quoteAll, including empty cells', () => {
    expect(escapeCsvCell('x', { quoteAll: true })).toBe('"x"');
    expect(escapeCsvCell(null, { quoteAll: true })).toBe('""');
    expect(escapeCsvCell(5, { quoteAll: true })).toBe('"5"');
  });

  it.each(['', ',,', '"', '\n', '\r', 'ab', null, 5])('rejects the invalid delimiter %j', (delimiter) => {
    expect(() => escapeCsvCell('x', { delimiter })).toThrow(RangeError);
  });
});

describe('escapeCsvCell: formula injection', () => {
  it.each([
    '=SUM(A1:A9)',
    "=cmd|' /C calc'!A0",
    '+SUM(1,1)',
    '-2+3+cmd',
    '@SUM(A1)',
    '|calc',
    '\t=1',
    '\r=1',
    '+CMD',
    '-A1',
    '=1+1'
  ])('prefixes %j with a single quote', (value) => {
    expect(isGuarded(escapeCsvCell(value))).toBe(true);
  });

  it('keeps a quoted and prefixed cell correct', () => {
    expect(escapeCsvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
  });

  it.each([
    '+33612345678',
    '+33 6 12 34 56 78',
    '+33 (0)6.12.34.56.78',
    '(01) 23 45 67 89',
    '0612345678',
    '06-12-34-56-78',
    '+1 555 123-4567',
    '+33 6 12',
    '-5',
    '+5',
    '42',
    '3.14',
    ' +33 6 12'
  ])('does not prefix the phone number or number %j', (value) => {
    expect(escapeCsvCell(value)).toBe(value);
  });

  it('does not prefix a French decimal either', () => {
    expect(escapeCsvCell('-3,5', { delimiter: ';' })).toBe('-3,5');
  });

  it.each([
    '+',
    '-',
    '--',
    '+-',
    '++33612345678',
    '+33+1',
    '-1+2',
    '+33612345678x',
    '+33 6 12 =1',
    '-(1)+cmd',
    '\t12',
    '\r12',
    '\t+33612345678',
    '-2e3',
    '+1,2,3'
  ])('still prefixes the non-phone %j', (value) => {
    expect(isGuarded(escapeCsvCell(value))).toBe(true);
  });

  it('does not touch values whose dangerous character is not leading', () => {
    expect(escapeCsvCell('a=b')).toBe('a=b');
    expect(escapeCsvCell('a+b')).toBe('a+b');
    expect(escapeCsvCell(' =1')).toBe(' =1');
  });
});

describe('unescapeCsvCell', () => {
  it('strips the guard added by escapeCsvCell', () => {
    expect(unescapeCsvCell("'=1+1")).toBe('=1+1');
    expect(unescapeCsvCell("'+CMD")).toBe('+CMD');
    expect(unescapeCsvCell("'@x")).toBe('@x');
    expect(unescapeCsvCell("'|x")).toBe('|x');
    expect(unescapeCsvCell("'-x")).toBe('-x');
    expect(unescapeCsvCell("'\t=x")).toBe('\t=x');
  });

  it('leaves everything else alone', () => {
    for (const value of [
      '',
      'plain',
      "'quoted text",
      "it's",
      "'",
      "''x",
      '+33612345678',
      '=1',
      'a',
      12,
      null,
      undefined
    ]) {
      expect(unescapeCsvCell(value)).toBe(value);
    }
  });

  it('strips only one level', () => {
    expect(unescapeCsvCell("''=1")).toBe("'=1");
  });

  it('is the exact inverse of the guard for any string (cell level)', () => {
    const samples = [
      '',
      'x',
      '=1',
      '+33612345678',
      '-5',
      "'=1",
      "''=1",
      "'+33612345678",
      "'-5",
      "'x",
      "'",
      '|',
      "'|a",
      '\t=x',
      '\r',
      '@a',
      '+',
      '-',
      '--1',
      '(01) 23',
      "'(01) 23",
      'é=€',
      '=',
      "'="
    ];
    for (const sample of samples) {
      const escaped = escapeCsvCell(sample);
      const unquoted = escaped.startsWith('"') ? escaped.slice(1, -1).replaceAll('""', '"') : escaped;
      expect(unescapeCsvCell(unquoted)).toBe(sample);
    }
  });
});

describe('guard exactness', () => {
  it('unescape(escape(s)) === s for every string up to length 5 over a hostile alphabet', () => {
    const alphabet = ["'", '=', '+', '-', '@', '\t', '\r', '|', 'a', '1', '(', ' ', '.'];
    let checked = 0;
    const visit = (prefix, depth) => {
      const escaped = escapeCsvCell(prefix);
      const unquoted = escaped.startsWith('"') ? escaped.slice(1, -1).replaceAll('""', '"') : escaped;
      if (unescapeCsvCell(unquoted) !== prefix) throw new Error(`not reversible: ${JSON.stringify(prefix)}`);
      checked++;
      if (depth === 0) return;
      for (const char of alphabet) visit(prefix + char, depth - 1);
    };
    visit('', 5);
    expect(checked).toBeGreaterThan(300_000);
  });
});

describe('generateCsv', () => {
  it('writes array rows without a header by default, CRLF-separated, no trailing eol', () => {
    expect(
      generateCsv([
        [1, 'a'],
        [2, 'b']
      ])
    ).toBe('1,a\r\n2,b');
  });

  it('derives the header from the first object row when there are no columns', () => {
    expect(generateCsv([{ a: 1, b: 'x' }, { a: 2 }])).toBe('a,b\r\n1,x\r\n2,');
  });

  it('uses columns for headers and values (string, key, value())', () => {
    const rows = [{ id: 1, first_name: 'Ada', email: 'ada@x.fr', tags: ['a', 'b'] }];
    const csv = generateCsv(rows, {
      columns: [
        'id',
        { header: 'Prénom', key: 'first_name' },
        { header: 'Mail', key: 'email' },
        { header: 'Tags', value: (row) => row.tags.join('|') },
        { header: 'Absent', key: 'nope' },
        { key: 'id' }
      ]
    });
    expect(csv).toBe('id,Prénom,Mail,Tags,Absent,id\r\n1,Ada,ada@x.fr,a|b,,1');
  });

  it('falls back to the header as the key for object rows', () => {
    expect(generateCsv([{ name: 'Ada' }], { columns: [{ header: 'name' }] })).toBe('name\r\nAda');
  });

  it('resolves columns by position for array rows', () => {
    const columns = ['A', { header: 'B', key: 2 }, { header: 'C' }];
    expect(generateCsv([[1, 'x', 'y']], { columns })).toBe('A,B,C\r\n1,y,y');
  });

  it('emits only the header when there are no rows', () => {
    expect(generateCsv([], { columns: ['a', 'b'] })).toBe('a,b');
    expect(generateCsv([])).toBe('');
  });

  it('ignores inherited properties and non-object rows', () => {
    expect(generateCsv([{ a: 1 }, null, 'str'], { columns: ['a', 'toString', 'constructor'] })).toBe(
      'a,toString,constructor\r\n1,,\r\n,,\r\n,,'
    );
    expect(generateCsv([[1], null])).toBe('1\r\n');
  });

  it('supports delimiter, bom, quoteAll and eol', () => {
    const csv = generateCsv([['a;b', 'c']], {
      columns: ['x', 'y'],
      delimiter: ';',
      bom: true,
      quoteAll: true,
      eol: '\n'
    });
    expect(csv).toBe(`${CSV_BOM}"x";"y"\n"a;b";"c"`);
    expect(csv.codePointAt(0)).toBe(0xfe_ff);
  });

  it('neutralises formulas in headers and cells but keeps phone numbers', () => {
    const csv = generateCsv([{ n: '=1+1', p: '+33612345678' }], { columns: [{ header: '=h', key: 'n' }, 'n', 'p'] });
    expect(csv).toBe("'=h,n,p\r\n'=1+1,'=1+1,+33612345678");
  });

  it('rejects non-array rows and bad delimiters', () => {
    expect(() => generateCsv('nope')).toThrow(TypeError);
    expect(() => generateCsv({})).toThrow(TypeError);
    expect(() => generateCsv([['a']], { delimiter: '"' })).toThrow(RangeError);
  });

  it('does not throw when the first row is null and there are no columns', () => {
    expect(() => generateCsv([null, { a: 1 }])).not.toThrow();
  });
});

describe('parseCsv', () => {
  it('parses headers and rows', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual({
      headers: ['a', 'b'],
      rows: [
        ['1', '2'],
        ['3', '4']
      ],
      delimiter: ','
    });
  });

  it('strips a BOM', () => {
    expect(parseCsv(`${CSV_BOM}a,b\n1,2`).headers).toEqual(['a', 'b']);
  });

  it('handles LF, CRLF and CR line endings', () => {
    for (const eol of ['\n', '\r\n', '\r']) {
      expect(parseCsv(`a,b${eol}1,2${eol}3,4${eol}`).rows).toEqual([
        ['1', '2'],
        ['3', '4']
      ]);
    }
  });

  it('handles quoted cells with delimiters, newlines, CRLF and escaped quotes', () => {
    const { rows } = parseCsv('a,b\r\n"x, y","line1\nline2"\r\n"say ""hi""","c\r\nd"');
    expect(rows).toEqual([
      ['x, y', 'line1\nline2'],
      ['say "hi"', 'c\r\nd']
    ]);
  });

  it('auto-detects ; and tab delimiters from the header line', () => {
    expect(parseCsv('a;b;c\n1;2;3')).toEqual({ headers: ['a', 'b', 'c'], rows: [['1', '2', '3']], delimiter: ';' });
    expect(parseCsv('a\tb\n1\t2')).toEqual({ headers: ['a', 'b'], rows: [['1', '2']], delimiter: '\t' });
  });

  it('only splits on the detected delimiter', () => {
    expect(parseCsv('nom;prénom\nDoe, John;Jo').rows).toEqual([['Doe, John', 'Jo']]);
    expect(parseCsv('a,b\n1;2,3').rows).toEqual([['1;2', '3']]);
  });

  it('ignores delimiters inside quoted headers when detecting', () => {
    expect(parseCsv('"a,b,c";d\n1;2').delimiter).toBe(';');
    expect(parseCsv('"a;b;c",d\n1,2').delimiter).toBe(',');
    expect(parseCsv('"a""x;;;",d\n1,2').delimiter).toBe(',');
  });

  it('detects the delimiter on the first line only, even when a quoted cell spans lines', () => {
    expect(parseCsv('"multi\nline;;;";x;y\n1;2;3').delimiter).toBe(';');
    expect(parseCsv('a,b\n1;2;3;4;5').delimiter).toBe(',');
  });

  it('falls back to comma for a single column, a tie or empty input', () => {
    expect(parseCsv('a\n1').delimiter).toBe(',');
    expect(parseCsv('a,b;c\n1,2;3').delimiter).toBe(',');
    expect(parseCsv('').delimiter).toBe(',');
  });

  it('drops blank lines and all-empty rows', () => {
    expect(parseCsv('a,b\n\n1,2\n   \n,\n3,4\n\n').rows).toEqual([
      ['1', '2'],
      ['3', '4']
    ]);
  });

  it('trims cells, quoted ones included', () => {
    expect(parseCsv(' a , b \n  1 ,  " 2 "  ').rows).toEqual([['1', '2']]);
  });

  it('keeps a stray quote inside unquoted text literally', () => {
    expect(parseCsv('a,b\n5" tall,x\n2,3').rows).toEqual([
      ['5" tall', 'x'],
      ['2', '3']
    ]);
  });

  it('runs an unterminated quote to the end of the input', () => {
    expect(parseCsv('a,b\n"open,1\n2,3').rows).toEqual([['open,1\n2,3']]);
  });

  it('returns empty structures for empty or non-string input', () => {
    for (const input of ['', '\n\n', null, undefined, 42, {}]) {
      expect(parseCsv(input)).toEqual({ headers: [], rows: [], delimiter: ',' });
    }
  });

  it('returns the header alone when there are no data rows', () => {
    expect(parseCsv('a,b')).toEqual({ headers: ['a', 'b'], rows: [], delimiter: ',' });
  });

  it('keeps ragged rows as they are', () => {
    expect(parseCsv('a,b,c\n1\n1,2,3,4').rows).toEqual([['1'], ['1', '2', '3', '4']]);
  });
});

describe('CSV round trips', () => {
  const tricky = [
    'plain',
    'with space inside',
    'comma, inside',
    'semi; inside',
    'tab\tinside',
    'quote " inside',
    '""',
    '"',
    'multi\nline',
    'crlf\r\nline',
    'lone\rcr',
    'trailing,',
    ',leading',
    'émoji 🎓 ünï',
    '+33612345678',
    '+33 6 12 34 56 78',
    '=1+1',
    '=HYPERLINK("http://evil","x")',
    '@SUM(A1)',
    '-2+3',
    '|calc',
    "'=1",
    "'+33612345678",
    "it's",
    "'",
    '5" tall'
  ];

  for (const delimiter of [',', ';', '\t']) {
    for (const bom of [false, true]) {
      for (const eol of ['\r\n', '\n']) {
        it(`round-trips tricky cells (delimiter ${JSON.stringify(delimiter)}, bom ${bom}, eol ${JSON.stringify(eol)})`, () => {
          const rows = tricky.map((cell, i) => [i, cell, `after-${i}`]);
          const csv = generateCsv(rows, { columns: ['id', 'value', 'tail'], delimiter, bom, eol });
          const parsed = parseCsv(csv);
          expect(parsed.delimiter).toBe(delimiter);
          expect(parsed.headers).toEqual(['id', 'value', 'tail']);
          expect(parsed.rows.map((r) => [r[0], unescapeCsvCell(r[1]), r[2]])).toEqual(
            rows.map(([i, cell, tail]) => [String(i), cell, tail])
          );
        });
      }
    }
  }

  it('round-trips with quoteAll and keeps phone numbers unprefixed on the wire', () => {
    const csv = generateCsv([['+33612345678', '=evil']], { columns: ['tel', 'x'], quoteAll: true });
    expect(csv).toBe('"tel","x"\r\n"+33612345678","\'=evil"');
    expect(parseCsv(csv).rows.map((r) => r.map(unescapeCsvCell))).toEqual([['+33612345678', '=evil']]);
  });

  it('round-trips headers with an accent and the other delimiter', () => {
    const csv = generateCsv([['x', 'y', 'z']], { columns: ['Prénom', 'Nom, usuel', 'Tél'], delimiter: ';' });
    expect(parseCsv(csv).headers).toEqual(['Prénom', 'Nom, usuel', 'Tél']);
  });
});

describe('mapCsvHeaders', () => {
  const aliases = { firstName: ['prénom', 'firstname'], email: ['email', 'mail'], phone: ['téléphone', 'tel'] };

  it('maps field names to column indexes, case- and space-insensitively', () => {
    expect(mapCsvHeaders([' Prénom ', 'MAIL', 'Inconnu', 'Tel'], aliases)).toEqual({
      firstName: 0,
      email: 1,
      phone: 3
    });
  });

  it('lets the last matching column win and tolerates non-string headers', () => {
    expect(mapCsvHeaders(['email', 'mail', 5, null], aliases)).toEqual({ email: 1 });
  });

  it('returns an empty map for no match', () => {
    expect(mapCsvHeaders([], aliases)).toEqual({});
    expect(mapCsvHeaders(['x'], aliases)).toEqual({});
  });
});

describe('csvResponse', () => {
  const disposition = (filename) => csvResponse('a', filename).headers.get('Content-Disposition');

  it('sets content type, attachment and the body', async () => {
    const response = csvResponse('a,b', 'members.csv');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="members.csv"');
    expect(await response.text()).toBe('a,b');
  });

  it('strips CR/LF, quotes, separators and control characters from the filename', () => {
    expect(disposition('a\r\nSet-Cookie: x=1.csv')).toBe('attachment; filename="aSet-Cookie: x=1.csv"');
    expect(disposition('a"b.csv')).toBe('attachment; filename="ab.csv"');
    expect(disposition('../../etc/passwd')).toBe('attachment; filename="etcpasswd"');
    expect(disposition(String.raw`..\..\win.csv`)).toBe('attachment; filename="win.csv"');
    expect(disposition('a;b.csv')).toBe('attachment; filename="ab.csv"');
    expect(disposition('a\u0000b\u007f.csv')).toBe('attachment; filename="ab.csv"');
  });

  it('cannot inject a header or break out of the quotes', () => {
    const response = csvResponse('x', 'evil.csv"\r\nX-Injected: yes\r\n\r\n<script>');
    expect(response.headers.get('X-Injected')).toBeNull();
    expect(response.headers.get('Content-Disposition')).not.toMatch(/[\r\n]/);
    expect(response.headers.get('Content-Disposition').match(/"/g)).toHaveLength(2);
  });

  it('removes bidi override characters', () => {
    expect(disposition('evil‮fdp.csv')).toBe('attachment; filename="evilfdp.csv"');
  });

  it('gives non-ASCII names an ASCII fallback plus filename*', () => {
    expect(disposition("Étudiants d'été 100%.csv")).toBe(
      "attachment; filename=\"_tudiants d'_t_ 100_.csv\"; filename*=UTF-8''%C3%89tudiants%20d%27%C3%A9t%C3%A9%20100%25.csv"
    );
    expect(() => csvResponse('x', '€ 🎓.csv')).not.toThrow();
    expect(disposition('(a)*.csv')).toBe('attachment; filename="(a)*.csv"');
    expect(disposition('(é)*.csv')).toContain("filename*=UTF-8''%28%C3%A9%29%2A.csv");
  });

  it('falls back to export.csv for empty or hostile names and strips leading dots', () => {
    for (const name of ['', '   ', '"\r\n/', '...', null, undefined]) {
      expect(disposition(name)).toBe('attachment; filename="export.csv"');
    }
    expect(disposition('.hidden.csv')).toBe('attachment; filename="hidden.csv"');
    expect(disposition(42)).toBe('attachment; filename="42"');
  });

  it('caps very long names', () => {
    expect(disposition(`${'a'.repeat(1000)}.csv`).length).toBeLessThan(260);
  });

  it('lets extra headers be added', () => {
    expect(csvResponse('x', 'a.csv', { 'Cache-Control': 'no-store' }).headers.get('Cache-Control')).toBe('no-store');
  });
});
