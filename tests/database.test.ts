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
  test('creates a payout with imported rows and records one signature', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'zarplati-db-'));
    tempDirs.push(root);
    const db = createAppDatabase(path.join(root, 'app.db'));

    const payout = db.createPayout({ title: 'Аванс за апрель', basis: 'Аванс за 26 апреля 2026' });
    db.replacePayoutRows(payout.id, [
      { fullName: 'Иванов Иван Иванович', amount: 35000 },
      { fullName: 'Петрова Анна Сергеевна', amount: 42500.5 }
    ]);
    const rowsBefore = db.listRows(payout.id);

    db.markRowSigned({ payoutId: payout.id, rowId: rowsBefore[0].id, signaturePath: 'signatures/1/1.png', signedAt: '2026-04-26T10:00:00.000Z' });

    const rowsAfter = db.listRows(payout.id);
    expect(rowsAfter).toMatchObject([
      { fullName: 'Иванов Иван Иванович', amount: 35000, paidAt: '2026-04-26T10:00:00.000Z', signaturePath: 'signatures/1/1.png' },
      { fullName: 'Петрова Анна Сергеевна', amount: 42500.5, paidAt: null, signaturePath: null }
    ]);
    expect(db.searchRows(payout.id, 'анна')).toHaveLength(1);

    db.close();
  });
});
