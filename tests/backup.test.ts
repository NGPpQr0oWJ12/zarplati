import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createBackupPayload, parseBackupPayload, stageBackupSignatures } from '../server/backup';
import { createAppDatabase } from '../server/database';

const tempDirs: string[] = [];
const tinyPng = Buffer.from('iVBORw0KGgo=', 'base64');

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('backup import and export', () => {
  test('round-trips payouts and signature files', () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'zarplati-backup-source-'));
    const targetRoot = mkdtempSync(path.join(tmpdir(), 'zarplati-backup-target-'));
    tempDirs.push(sourceRoot, targetRoot);

    const sourceDb = createAppDatabase(path.join(sourceRoot, 'app.db'));
    const payout = sourceDb.createPayout({ title: 'Аванс за июнь', basis: 'Ведомость за 17 июня 2026' });
    sourceDb.replacePayoutRows(payout.id, [{ fullName: 'Иванов Иван', amount: 12000 }]);
    const row = sourceDb.listRows(payout.id)[0];
    const signaturePath = path.join(sourceRoot, 'signatures', String(payout.id), `${row.id}.png`);
    mkdirSync(path.dirname(signaturePath), { recursive: true });
    writeFileSync(signaturePath, tinyPng);
    sourceDb.markRowSigned({
      payoutId: payout.id,
      rowId: row.id,
      paidAmount: 12000,
      signaturePath: `signatures/${payout.id}/${row.id}.png`,
      signedAt: '2026-06-17T10:00:00.000Z'
    });

    const payload = createBackupPayload({ storageRoot: sourceRoot, database: sourceDb.exportData() });
    const parsed = parseBackupPayload(Buffer.from(JSON.stringify(payload), 'utf8'));
    const stagedSignatures = stageBackupSignatures(targetRoot, parsed.signatures);
    const targetDb = createAppDatabase(path.join(targetRoot, 'app.db'));

    targetDb.replaceAllData(parsed.database);
    stagedSignatures.commit();
    stagedSignatures.cleanup();

    expect(targetDb.exportData()).toEqual(sourceDb.exportData());
    const restoredSignaturePath = path.join(targetRoot, 'signatures', String(payout.id), `${row.id}.png`);
    expect(existsSync(restoredSignaturePath)).toBe(true);
    expect(readFileSync(restoredSignaturePath)).toEqual(tinyPng);

    sourceDb.close();
    targetDb.close();
  });

  test('rejects a backup with an unsafe signature path', () => {
    const payload = {
      format: 'zarplati.backup',
      version: 1,
      exportedAt: '2026-06-17T10:00:00.000Z',
      database: {
        payouts: [{ id: 1, title: 'Выплата', basis: 'Основание', status: 'active', createdAt: '2026-06-17T10:00:00.000Z' }],
        rows: [{
          id: 1,
          payoutId: 1,
          fullName: 'Иванов Иван',
          amount: 1000,
          paidAmount: 1000,
          paidAt: '2026-06-17T10:00:00.000Z',
          signaturePath: '../outside.png',
          createdAt: '2026-06-17T10:00:00.000Z'
        }]
      },
      signatures: { '../outside.png': tinyPng.toString('base64') }
    };

    expect(() => parseBackupPayload(Buffer.from(JSON.stringify(payload), 'utf8'))).toThrow('Некорректный путь подписи');
  });
});
