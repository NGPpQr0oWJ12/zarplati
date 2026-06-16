import { describe, expect, test } from 'vitest';
import { summarizeRows } from '../server/summary';

describe('summarizeRows', () => {
  test('counts full, partial and pending payout totals', () => {
    const summary = summarizeRows([
      { amount: 1000, paidAmount: 1000, paidAt: '2026-04-26T10:00:00.000Z' },
      { amount: 2000, paidAmount: null, paidAt: null },
      { amount: 500.5, paidAmount: 200.25, paidAt: '2026-04-26T11:00:00.000Z' }
    ]);

    expect(summary).toEqual({
      totalAmount: 3500.5,
      paidAmount: 1200.25,
      pendingAmount: 2300.25,
      totalCount: 3,
      paidCount: 2,
      partialCount: 1,
      pendingCount: 1
    });
  });
});
