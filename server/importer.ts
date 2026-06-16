import * as XLSX from 'xlsx';

export type ImportedPayoutRow = {
  fullName: string;
  amount: number;
};

function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^а-яa-z0-9]+/g, '');
}

function normalizeCell(value: unknown) {
  return String(value ?? '').trim();
}

function parseAmount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const normalized = String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');

  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100) / 100;
}

function detectDelimiter(line: string) {
  const candidates = [';', ',', '\t'];
  return candidates.reduce((best, delimiter) => {
    const count = line.split(delimiter).length;
    return count > line.split(best).length ? delimiter : best;
  }, ';');
}

function parseCsvLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function csvToRows(buffer: Buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines[0]);
  return lines.map((line) => parseCsvLine(line, delimiter));
}

function workbookToRows(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheetName], {
    header: 1,
    raw: false,
    blankrows: false
  });
}

function isFullNameHeader(header: string) {
  return ['фио', 'сотрудник', 'фамилияимяотчество', 'полноеимя', 'fullname', 'employee'].includes(header);
}

function isAmountHeader(header: string) {
  return ['сумма', 'суммавыплаты', 'квыплате', 'выплата', 'amount', 'sum'].includes(header);
}

export function parseImportWorkbook(buffer: Buffer, filename: string): ImportedPayoutRow[] {
  const rows = filename.toLowerCase().endsWith('.csv') ? csvToRows(buffer) : workbookToRows(buffer);
  const [headerRow, ...dataRows] = rows;

  if (!headerRow) throw new Error('Файл должен содержать колонки ФИО и Сумма');

  const headers = headerRow.map(normalizeHeader);
  const fullNameIndex = headers.findIndex(isFullNameHeader);
  const amountIndex = headers.findIndex(isAmountHeader);

  if (fullNameIndex === -1 || amountIndex === -1) {
    throw new Error('Файл должен содержать колонки ФИО и Сумма');
  }

  const importedRows = dataRows
    .map((row) => {
      const fullName = normalizeCell(row[fullNameIndex]);
      const amount = parseAmount(row[amountIndex]);
      if (!fullName || amount === null) return null;
      return { fullName, amount };
    })
    .filter((row): row is ImportedPayoutRow => Boolean(row));

  if (importedRows.length === 0) {
    throw new Error('В файле нет строк сотрудников с ФИО и суммой');
  }

  return importedRows;
}
