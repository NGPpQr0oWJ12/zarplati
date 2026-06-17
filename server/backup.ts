import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { DatabaseExport, Payout, PayoutRow } from './database';

const BACKUP_FORMAT = 'zarplati.backup';
const BACKUP_VERSION = 1;
const SIGNATURE_PREFIX = 'signatures/';
const SIGNATURE_PATH_PATTERN = /^signatures\/[1-9]\d*\/[1-9]\d*\.png$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

export type BackupPayload = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  database: DatabaseExport;
  signatures: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`Некорректное значение ${label}`);
  return Number(value);
}

function parseText(value: unknown, label: string) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Некорректное значение ${label}`);
  return value;
}

function parseNullableText(value: unknown, label: string) {
  if (value === null) return null;
  return parseText(value, label);
}

function parseMoney(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Некорректная сумма ${label}`);
  return Math.round(value * 100) / 100;
}

function parseNullableMoney(value: unknown, label: string) {
  if (value === null) return null;
  return parseMoney(value, label);
}

function normalizeSignaturePath(value: string) {
  const normalized = value.replaceAll('\\', '/');
  if (!SIGNATURE_PATH_PATTERN.test(normalized)) throw new Error(`Некорректный путь подписи: ${value}`);
  return normalized;
}

function signatureFilePath(storageRoot: string, relativePath: string) {
  const normalized = normalizeSignaturePath(relativePath);
  return path.join(storageRoot, ...normalized.split('/'));
}

function decodeSignature(base64: string, relativePath: string) {
  if (typeof base64 !== 'string' || base64.length === 0) throw new Error(`Пустой файл подписи: ${relativePath}`);
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length < PNG_MAGIC.length || !buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new Error(`Подпись в резервной копии должна быть PNG: ${relativePath}`);
  }
  return buffer;
}

function parsePayout(value: unknown, index: number): Payout {
  if (!isRecord(value)) throw new Error(`Некорректная выплата #${index + 1}`);
  const status = parseText(value.status, `database.payouts[${index}].status`);
  if (status !== 'active' && status !== 'closed') throw new Error(`Некорректный статус выплаты #${index + 1}`);

  return {
    id: parsePositiveInteger(value.id, `database.payouts[${index}].id`),
    title: parseText(value.title, `database.payouts[${index}].title`),
    basis: parseText(value.basis, `database.payouts[${index}].basis`),
    status,
    createdAt: parseText(value.createdAt, `database.payouts[${index}].createdAt`)
  };
}

function parseRow(value: unknown, index: number, payoutIds: Set<number>, signatures: Record<string, string>): PayoutRow {
  if (!isRecord(value)) throw new Error(`Некорректная строка выплаты #${index + 1}`);
  const payoutId = parsePositiveInteger(value.payoutId, `database.rows[${index}].payoutId`);
  if (!payoutIds.has(payoutId)) throw new Error(`Строка #${index + 1} ссылается на отсутствующую выплату`);

  const signaturePath = parseNullableText(value.signaturePath, `database.rows[${index}].signaturePath`);
  const normalizedSignaturePath = signaturePath ? normalizeSignaturePath(signaturePath) : null;
  if (normalizedSignaturePath && !(normalizedSignaturePath in signatures)) {
    throw new Error(`В резервной копии нет файла подписи: ${normalizedSignaturePath}`);
  }

  return {
    id: parsePositiveInteger(value.id, `database.rows[${index}].id`),
    payoutId,
    fullName: parseText(value.fullName, `database.rows[${index}].fullName`),
    amount: parseMoney(value.amount, `database.rows[${index}].amount`),
    paidAmount: parseNullableMoney(value.paidAmount, `database.rows[${index}].paidAmount`),
    paidAt: parseNullableText(value.paidAt, `database.rows[${index}].paidAt`),
    signaturePath: normalizedSignaturePath,
    createdAt: parseText(value.createdAt, `database.rows[${index}].createdAt`)
  };
}

export function createBackupPayload(input: { storageRoot: string; database: DatabaseExport }): BackupPayload {
  const signatures: Record<string, string> = {};

  for (const row of input.database.rows) {
    if (!row.signaturePath || signatures[row.signaturePath]) continue;
    const relativePath = normalizeSignaturePath(row.signaturePath);
    const absolutePath = signatureFilePath(input.storageRoot, relativePath);
    if (!existsSync(absolutePath)) throw new Error(`Не найден файл подписи для экспорта: ${relativePath}`);
    signatures[relativePath] = readFileSync(absolutePath).toString('base64');
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    database: input.database,
    signatures
  };
}

export function parseBackupPayload(buffer: Buffer) {
  const payload = JSON.parse(buffer.toString('utf8')) as unknown;
  if (!isRecord(payload) || payload.format !== BACKUP_FORMAT || payload.version !== BACKUP_VERSION) {
    throw new Error('Файл не является резервной копией выплат');
  }
  if (!isRecord(payload.database)) throw new Error('В резервной копии нет данных базы');
  if (!Array.isArray(payload.database.payouts) || !Array.isArray(payload.database.rows)) {
    throw new Error('Некорректная структура резервной копии');
  }
  if (!isRecord(payload.signatures)) throw new Error('В резервной копии нет блока подписей');

  const signatures: Record<string, string> = {};
  for (const [relativePath, base64] of Object.entries(payload.signatures)) {
    const normalizedPath = normalizeSignaturePath(relativePath);
    signatures[normalizedPath] = parseText(base64, `signatures.${normalizedPath}`);
    decodeSignature(signatures[normalizedPath], normalizedPath);
  }

  const payouts = payload.database.payouts.map(parsePayout);
  const payoutIds = new Set<number>();
  for (const payout of payouts) {
    if (payoutIds.has(payout.id)) throw new Error(`Повторяющийся ID выплаты: ${payout.id}`);
    payoutIds.add(payout.id);
  }

  const rowIds = new Set<number>();
  const rows = payload.database.rows.map((row, index) => parseRow(row, index, payoutIds, signatures));
  for (const row of rows) {
    if (rowIds.has(row.id)) throw new Error(`Повторяющийся ID строки выплаты: ${row.id}`);
    rowIds.add(row.id);
  }

  return { database: { payouts, rows }, signatures };
}

export function stageBackupSignatures(storageRoot: string, signatures: Record<string, string>) {
  const tempRoot = path.join(storageRoot, `.signatures-import-${randomUUID()}`);
  mkdirSync(tempRoot, { recursive: true });
  let committed = false;

  for (const [relativePath, base64] of Object.entries(signatures)) {
    const normalizedPath = normalizeSignaturePath(relativePath);
    const buffer = decodeSignature(base64, normalizedPath);
    const signatureLocalPath = normalizedPath.slice(SIGNATURE_PREFIX.length);
    const absolutePath = path.join(tempRoot, ...signatureLocalPath.split('/'));
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, buffer);
  }

  return {
    commit() {
      const finalRoot = path.join(storageRoot, 'signatures');
      rmSync(finalRoot, { recursive: true, force: true });
      renameSync(tempRoot, finalRoot);
      committed = true;
    },
    cleanup() {
      if (!committed) rmSync(tempRoot, { recursive: true, force: true });
    }
  };
}
