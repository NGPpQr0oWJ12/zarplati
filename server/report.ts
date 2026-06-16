import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import type { Payout, PayoutRow } from './database';
import { summarizeRows } from './summary';

export async function buildPayoutReport(input: { payout: Payout; rows: PayoutRow[]; storageRoot: string }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Выплаты';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Ведомость');
  worksheet.columns = [
    { header: 'ФИО', key: 'fullName', width: 34 },
    { header: 'Сумма к выплате', key: 'amount', width: 18 },
    { header: 'Выдано в кассе', key: 'paidAmount', width: 18 },
    { header: 'Остаток', key: 'remainingAmount', width: 18 },
    { header: 'Статус', key: 'status', width: 22 },
    { header: 'Дата и время подписи', key: 'paidAt', width: 24 },
    { header: 'Подпись', key: 'signature', width: 24 }
  ];

  worksheet.insertRow(1, [`Выплата: ${input.payout.title}`]);
  worksheet.insertRow(2, [`Основание: ${input.payout.basis}`]);
  worksheet.insertRow(3, []);
  worksheet.getRow(4).font = { bold: true };
  worksheet.getRow(1).font = { bold: true, size: 14 };
  worksheet.getRow(2).font = { color: { argb: '666666' } };

  input.rows.forEach((row) => {
    const paidAmount = row.paidAt ? row.paidAmount ?? row.amount : 0;
    const remainingAmount = Math.max(0, row.amount - paidAmount);
    const status = !row.paidAt ? 'Не получил' : remainingAmount > 0 ? 'Получил частично' : 'Получил полностью';
    const excelRow = worksheet.addRow({
      fullName: row.fullName,
      amount: row.amount,
      paidAmount: row.paidAt ? paidAmount : '',
      remainingAmount,
      status,
      paidAt: row.paidAt ? new Date(row.paidAt).toLocaleString('ru-RU') : '',
      signature: row.signaturePath ? 'Подпись ниже' : ''
    });

    excelRow.height = row.signaturePath ? 48 : 22;
    excelRow.getCell('amount').numFmt = '#,##0.00';
    excelRow.getCell('paidAmount').numFmt = '#,##0.00';
    excelRow.getCell('remainingAmount').numFmt = '#,##0.00';

    if (row.signaturePath) {
      const absoluteSignaturePath = path.join(input.storageRoot, row.signaturePath);
      if (existsSync(absoluteSignaturePath)) {
        const base64 = `data:image/png;base64,${readFileSync(absoluteSignaturePath).toString('base64')}`;
        const imageId = workbook.addImage({ base64, extension: 'png' });
        worksheet.addImage(imageId, {
          tl: { col: 6.05, row: excelRow.number - 0.9 },
          ext: { width: 130, height: 42 },
          editAs: 'oneCell'
        });
      }
    }
  });

  const summary = summarizeRows(input.rows);
  const startSummaryRow = worksheet.rowCount + 2;
  worksheet.addRow([]);
  worksheet.addRow(['Всего к выплате', summary.totalAmount]);
  worksheet.addRow(['Выплачено', summary.paidAmount]);
  worksheet.addRow(['Остаток', summary.pendingAmount]);
  worksheet.addRow(['Количество сотрудников', summary.totalCount]);
  worksheet.addRow(['Подписали', summary.paidCount]);
  worksheet.addRow(['Получили частично', summary.partialCount]);
  worksheet.addRow(['Не получили', summary.pendingCount]);

  for (let rowNumber = startSummaryRow; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    worksheet.getRow(rowNumber).font = { bold: true };
    worksheet.getRow(rowNumber).getCell(2).numFmt = '#,##0.00';
  }

  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'DDDDDD' } },
        left: { style: 'thin', color: { argb: 'DDDDDD' } },
        bottom: { style: 'thin', color: { argb: 'DDDDDD' } },
        right: { style: 'thin', color: { argb: 'DDDDDD' } }
      };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
  });

  return workbook.xlsx.writeBuffer();
}
