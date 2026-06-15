import { describe, expect, test } from 'vitest';
import { summarizeRows } from '../server/summary';

describe('summarizeRows', () => {
  test('counts paid and pending payout totals', () => {
    const summary = summarizeRows([
      { amount: 1000, paidAt: '2026-04-26T10:00:00.000Z' },
      { amount: 2000, paidAt: null },
      { amount: 500.5, paidAt: '2026-04-26T11:00:00.000Z' }
    ]);

    expect(summary).toEqual({
      totalAmount: 3500.5,
      paidAmount: 1500.5,
      pendingAmount: 2000,
      totalCount: 3,
      paidCount: 2,
      pendingCount: 1
    });
  });
});
