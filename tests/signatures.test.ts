import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { saveSignatureDataUrl } from '../server/signatures';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('saveSignatureDataUrl', () => {
  test('stores a png signature under payout and row identifiers', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'zarplati-'));
    tempDirs.push(root);
    const png = Buffer.from('iVBORw0KGgo=', 'base64');
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;

    const result = saveSignatureDataUrl({ storageRoot: root, payoutId: 7, rowId: 11, dataUrl });

    expect(result.relativePath).toBe('signatures/7/11.png');
    expect(readFileSync(result.absolutePath)).toEqual(png);
  });

  test('rejects non-png signature payloads', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'zarplati-'));
    tempDirs.push(root);

    expect(() => saveSignatureDataUrl({
      storageRoot: root,
      payoutId: 1,
      rowId: 2,
      dataUrl: 'data:text/plain;base64,SGVsbG8='
    })).toThrow('Подпись должна быть PNG-изображением');
  });
});
