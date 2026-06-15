import { describe, expect, test } from 'vitest';
import * as XLSX from 'xlsx';
import { parseImportWorkbook } from '../server/importer';

describe('parseImportWorkbook', () => {
  test('reads xlsx rows with full name and payout amount', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['ФИО', 'Сумма'],
      ['Иванов Иван Иванович', 35000],
      ['Петрова Анна Сергеевна', '42 500,50']
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Выплата');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const rows = parseImportWorkbook(buffer, 'april.xlsx');

    expect(rows).toEqual([
      { fullName: 'Иванов Иван Иванович', amount: 35000 },
      { fullName: 'Петрова Анна Сергеевна', amount: 42500.5 }
    ]);
  });

  test('reads csv rows with common Russian headers', () => {
    const csv = Buffer.from('фио;сумма выплаты\nСидоров Петр;12000\n', 'utf8');

    const rows = parseImportWorkbook(csv, 'advance.csv');

    expect(rows).toEqual([{ fullName: 'Сидоров Петр', amount: 12000 }]);
  });

  test('rejects files without full name and amount columns', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Имя', 'Телефон'], ['Иван', '123']]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Лист1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    expect(() => parseImportWorkbook(buffer, 'bad.xlsx')).toThrow('Файл должен содержать колонки ФИО и Сумма');
  });
});
