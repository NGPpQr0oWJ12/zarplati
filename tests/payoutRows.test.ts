import { describe, expect, test } from 'vitest';
import { filterRowsByStatus, getRowStatus } from '../src/payoutRows';

const rows = [
  { id: 1, amount: 1000, paidAmount: null, paidAt: null },
  { id: 2, amount: 1000, paidAmount: 1000, paidAt: '2026-04-26T10:00:00.000Z' },
  { id: 3, amount: 1000, paidAmount: 400, paidAt: '2026-04-26T11:00:00.000Z' }
];

describe('payout row status helpers', () => {
  test('detects pending, paid and partial rows', () => {
    expect(rows.map(getRowStatus)).toEqual(['pending', 'paid', 'partial']);
  });

  test('filters rows by selected status', () => {
    expect(filterRowsByStatus(rows, 'all').map((row) => row.id)).toEqual([1, 2, 3]);
    expect(filterRowsByStatus(rows, 'pending').map((row) => row.id)).toEqual([1]);
    expect(filterRowsByStatus(rows, 'paid').map((row) => row.id)).toEqual([2]);
    expect(filterRowsByStatus(rows, 'partial').map((row) => row.id)).toEqual([3]);
  });
});
