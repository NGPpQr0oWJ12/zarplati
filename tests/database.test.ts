import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createAppDatabase } from '../server/database';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('createAppDatabase', () => {
  test('creates a payout with imported rows and records one partial signature', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'zarplati-db-'));
    tempDirs.push(root);
    const db = createAppDatabase(path.join(root, 'app.db'));

    const payout = db.createPayout({ title: 'Аванс за апрель', basis: 'Аванс за 26 апреля 2026' });
    db.replacePayoutRows(payout.id, [
      { fullName: 'Иванов Иван Иванович', amount: 35000 },
      { fullName: 'Петрова Анна Сергеевна', amount: 42500.5 }
    ]);
    const rowsBefore = db.listRows(payout.id);

    db.markRowSigned({ payoutId: payout.id, rowId: rowsBefore[0].id, paidAmount: 20000, signaturePath: 'signatures/1/1.png', signedAt: '2026-04-26T10:00:00.000Z' });

    const rowsAfter = db.listRows(payout.id);
    expect(rowsAfter).toMatchObject([
      { fullName: 'Иванов Иван Иванович', amount: 35000, paidAmount: 20000, paidAt: '2026-04-26T10:00:00.000Z', signaturePath: 'signatures/1/1.png' },
      { fullName: 'Петрова Анна Сергеевна', amount: 42500.5, paidAmount: null, paidAt: null, signaturePath: null }
    ]);
    expect(db.searchRows(payout.id, 'анна')).toHaveLength(1);

    db.close();
  });

  test('deletes a payout and its rows from the database', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'zarplati-db-'));
    tempDirs.push(root);
    const db = createAppDatabase(path.join(root, 'app.db'));

    const payout = db.createPayout({ title: 'Тестовая ведомость', basis: 'Ошибочная загрузка' });
    db.replacePayoutRows(payout.id, [{ fullName: 'Иванов Иван', amount: 1000 }]);

    db.deletePayout(payout.id);

    expect(db.getPayout(payout.id)).toBeNull();
    expect(db.listRows(payout.id)).toEqual([]);

    db.close();
  });
});
