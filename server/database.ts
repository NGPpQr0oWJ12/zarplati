import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { ImportedPayoutRow } from './importer';
import { summarizeRows, type PayoutSummary } from './summary';

export type Payout = {
  id: number;
  title: string;
  basis: string;
  status: 'active' | 'closed';
  createdAt: string;
};

export type PayoutRow = {
  id: number;
  payoutId: number;
  fullName: string;
  amount: number;
  paidAmount: number | null;
  paidAt: string | null;
  signaturePath: string | null;
  createdAt: string;
};

export type PayoutListItem = Payout & {
  summary: PayoutSummary;
};

export type DatabaseExport = {
  payouts: Payout[];
  rows: PayoutRow[];
};

type PayoutRecord = {
  id: number;
  title: string;
  basis: string;
  status: 'active' | 'closed';
  created_at: string;
};

type PayoutRowRecord = {
  id: number;
  payout_id: number;
  full_name: string;
  amount: number;
  paid_amount: number | null;
  paid_at: string | null;
  signature_path: string | null;
  created_at: string;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function mapPayout(row: PayoutRecord): Payout {
  return {
    id: row.id,
    title: row.title,
    basis: row.basis,
    status: row.status,
    createdAt: row.created_at
  };
}

function mapPayoutRow(row: PayoutRowRecord): PayoutRow {
  return {
    id: row.id,
    payoutId: row.payout_id,
    fullName: row.full_name,
    amount: row.amount,
    paidAmount: row.paid_at && row.paid_amount === null ? row.amount : row.paid_amount,
    paidAt: row.paid_at,
    signaturePath: row.signature_path,
    createdAt: row.created_at
  };
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase().replaceAll('ё', 'е');
}

export function createAppDatabase(databasePath: string) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = DELETE');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      basis TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payout_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payout_id INTEGER NOT NULL,
      full_name TEXT NOT NULL,
      amount REAL NOT NULL,
      paid_amount REAL,
      paid_at TEXT,
      signature_path TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_payout_rows_payout ON payout_rows(payout_id);
  `);

  const columns = sqlite.prepare('PRAGMA table_info(payout_rows)').all() as { name: string }[];
  if (!columns.some((column) => column.name === 'paid_amount')) {
    sqlite.exec('ALTER TABLE payout_rows ADD COLUMN paid_amount REAL');
  }

  const getPayoutStatement = sqlite.prepare('SELECT * FROM payouts WHERE id = ?');
  const listRowsStatement = sqlite.prepare('SELECT * FROM payout_rows WHERE payout_id = ? ORDER BY full_name ASC');

  function getPayout(id: number) {
    const row = getPayoutStatement.get(id) as PayoutRecord | undefined;
    return row ? mapPayout(row) : null;
  }

  function listRows(payoutId: number) {
    return (listRowsStatement.all(payoutId) as PayoutRowRecord[]).map(mapPayoutRow);
  }

  return {
    createPayout(input: { title: string; basis: string }) {
      const title = input.title.trim();
      const basis = input.basis.trim();
      if (!title) throw new Error('Укажите название выплаты');
      if (!basis) throw new Error('Укажите основание выплаты');

      const createdAt = new Date().toISOString();
      const result = sqlite.prepare('INSERT INTO payouts (title, basis, status, created_at) VALUES (?, ?, ?, ?)')
        .run(title, basis, 'active', createdAt);

      const payout = getPayout(Number(result.lastInsertRowid));
      if (!payout) throw new Error('Не удалось создать выплату');
      return payout;
    },

    listPayouts(): PayoutListItem[] {
      const payouts = (sqlite.prepare('SELECT * FROM payouts ORDER BY created_at DESC').all() as PayoutRecord[]).map(mapPayout);
      return payouts.map((payout) => ({ ...payout, summary: summarizeRows(listRows(payout.id)) }));
    },

    exportData(): DatabaseExport {
      const payouts = (sqlite.prepare('SELECT * FROM payouts ORDER BY id ASC').all() as PayoutRecord[]).map(mapPayout);
      const rows = (sqlite.prepare('SELECT * FROM payout_rows ORDER BY payout_id ASC, id ASC').all() as PayoutRowRecord[]).map(mapPayoutRow);
      return { payouts, rows };
    },

    replaceAllData(input: DatabaseExport) {
      const insertPayout = sqlite.prepare(`
        INSERT INTO payouts (id, title, basis, status, created_at)
        VALUES (@id, @title, @basis, @status, @createdAt)
      `);
      const insertRow = sqlite.prepare(`
        INSERT INTO payout_rows (id, payout_id, full_name, amount, paid_amount, paid_at, signature_path, created_at)
        VALUES (@id, @payoutId, @fullName, @amount, @paidAmount, @paidAt, @signaturePath, @createdAt)
      `);
      const replace = sqlite.transaction((data: DatabaseExport) => {
        sqlite.prepare('DELETE FROM payout_rows').run();
        sqlite.prepare('DELETE FROM payouts').run();
        sqlite.prepare("DELETE FROM sqlite_sequence WHERE name IN ('payouts', 'payout_rows')").run();

        for (const payout of data.payouts) {
          insertPayout.run({
            id: payout.id,
            title: payout.title,
            basis: payout.basis,
            status: payout.status,
            createdAt: payout.createdAt
          });
        }

        for (const row of data.rows) {
          insertRow.run({
            id: row.id,
            payoutId: row.payoutId,
            fullName: row.fullName,
            amount: row.amount,
            paidAmount: row.paidAmount,
            paidAt: row.paidAt,
            signaturePath: row.signaturePath,
            createdAt: row.createdAt
          });
        }
      });

      replace(input);
    },

    getPayout,

    listRows,

    searchRows(payoutId: number, query: string) {
      const normalizedQuery = normalizeSearch(query);
      if (!normalizedQuery) return [];
      return listRows(payoutId).filter((row) => normalizeSearch(row.fullName).includes(normalizedQuery));
    },

    getRow(payoutId: number, rowId: number) {
      const row = sqlite.prepare('SELECT * FROM payout_rows WHERE payout_id = ? AND id = ?').get(payoutId, rowId) as PayoutRowRecord | undefined;
      return row ? mapPayoutRow(row) : null;
    },

    deletePayout(payoutId: number) {
      const payout = getPayout(payoutId);
      if (!payout) throw new Error('Выплата не найдена');
      sqlite.prepare('DELETE FROM payouts WHERE id = ?').run(payoutId);
    },

    replacePayoutRows(payoutId: number, rows: ImportedPayoutRow[]) {
      const payout = getPayout(payoutId);
      if (!payout) throw new Error('Выплата не найдена');

      const insert = sqlite.prepare('INSERT INTO payout_rows (payout_id, full_name, amount, created_at) VALUES (@payoutId, @fullName, @amount, @createdAt)');
      const replace = sqlite.transaction((items: ImportedPayoutRow[]) => {
        sqlite.prepare('DELETE FROM payout_rows WHERE payout_id = ?').run(payoutId);
        const createdAt = new Date().toISOString();
        for (const item of items) insert.run({ payoutId, fullName: item.fullName, amount: item.amount, createdAt });
      });

      replace(rows);
      return listRows(payoutId);
    },

    markRowSigned(input: { payoutId: number; rowId: number; paidAmount: number; signaturePath: string; signedAt: string }) {
      const row = this.getRow(input.payoutId, input.rowId);
      if (!row) throw new Error('Сотрудник не найден');
      if (row.paidAt) throw new Error('Эта выплата уже подписана');
      const paidAmount = roundMoney(input.paidAmount);
      if (!Number.isFinite(paidAmount) || paidAmount <= 0) throw new Error('Укажите фактически выданную сумму');
      if (paidAmount > row.amount) throw new Error('Фактическая сумма не может быть больше суммы к выплате');

      sqlite.prepare('UPDATE payout_rows SET paid_at = ?, paid_amount = ?, signature_path = ? WHERE payout_id = ? AND id = ?')
        .run(input.signedAt, paidAmount, input.signaturePath, input.payoutId, input.rowId);

      const updatedRow = this.getRow(input.payoutId, input.rowId);
      if (!updatedRow) throw new Error('Не удалось обновить выплату');
      return updatedRow;
    },

    resetRowSignature(input: { payoutId: number; rowId: number }) {
      const row = this.getRow(input.payoutId, input.rowId);
      if (!row) throw new Error('Сотрудник не найден');

      sqlite.prepare('UPDATE payout_rows SET paid_at = NULL, paid_amount = NULL, signature_path = NULL WHERE payout_id = ? AND id = ?')
        .run(input.payoutId, input.rowId);

      const updatedRow = this.getRow(input.payoutId, input.rowId);
      if (!updatedRow) throw new Error('Не удалось обновить выплату');
      return { row: updatedRow, previousSignaturePath: row.signaturePath };
    },

    close() {
      sqlite.close();
    }
  };
}

export type AppDatabase = ReturnType<typeof createAppDatabase>;
