import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type SaveSignatureInput = {
  storageRoot: string;
  payoutId: number;
  rowId: number;
  dataUrl: string;
};

export type SavedSignature = {
  relativePath: string;
  absolutePath: string;
};

export function saveSignatureDataUrl(input: SaveSignatureInput): SavedSignature {
  const prefix = 'data:image/png;base64,';
  if (!input.dataUrl.startsWith(prefix)) {
    throw new Error('Подпись должна быть PNG-изображением');
  }

  const base64 = input.dataUrl.slice(prefix.length);
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw new Error('Подпись пустая');

  const relativePath = path.posix.join('signatures', String(input.payoutId), `${input.rowId}.png`);
  const absolutePath = path.join(input.storageRoot, 'signatures', String(input.payoutId), `${input.rowId}.png`);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, buffer);

  return { relativePath, absolutePath };
}
