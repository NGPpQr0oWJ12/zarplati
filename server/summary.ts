export type SummaryInputRow = {
  amount: number;
  paidAmount: number | null;
  paidAt: string | null;
};

export type PayoutSummary = {
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  totalCount: number;
  paidCount: number;
  partialCount: number;
  pendingCount: number;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function summarizeRows(rows: SummaryInputRow[]): PayoutSummary {
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const paidRows = rows.filter((row) => Boolean(row.paidAt));
  const paidAmount = paidRows.reduce((sum, row) => sum + (row.paidAmount ?? row.amount), 0);
  const partialCount = paidRows.filter((row) => (row.paidAmount ?? row.amount) < row.amount).length;

  return {
    totalAmount: roundMoney(totalAmount),
    paidAmount: roundMoney(paidAmount),
    pendingAmount: roundMoney(totalAmount - paidAmount),
    totalCount: rows.length,
    paidCount: paidRows.length,
    partialCount,
    pendingCount: rows.length - paidRows.length
  };
}
