export type PayoutRowStatus = 'pending' | 'paid' | 'partial';
export type PayoutRowStatusFilter = 'all' | PayoutRowStatus;

export type PayoutRowLike = {
  amount: number;
  paidAmount: number | null;
  paidAt: string | null;
};

export function getActualPaidAmount(row: PayoutRowLike) {
  return row.paidAt ? row.paidAmount ?? row.amount : 0;
}

export function getRemainingAmount(row: PayoutRowLike) {
  return Math.max(0, row.amount - getActualPaidAmount(row));
}

export function getRowStatus(row: PayoutRowLike): PayoutRowStatus {
  if (!row.paidAt) return 'pending';
  if (getRemainingAmount(row) > 0) return 'partial';
  return 'paid';
}

export function filterRowsByStatus<T extends PayoutRowLike>(rows: T[], filter: PayoutRowStatusFilter) {
  if (filter === 'all') return rows;
  return rows.filter((row) => getRowStatus(row) === filter);
}
