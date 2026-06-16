import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { createAppDatabase } from './database';
import { parseImportWorkbook } from './importer';
import { buildPayoutReport } from './report';
import { saveSignatureDataUrl } from './signatures';
import { summarizeRows } from './summary';

const appRoot = process.cwd();
const storageRoot = process.env.STORAGE_DIR ? path.resolve(process.env.STORAGE_DIR) : path.join(appRoot, 'storage');
const databasePath = path.join(storageRoot, 'app.db');
const port = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
const adminLogin = process.env.ADMIN_LOGIN || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
const sessions = new Map<string, { login: string; createdAt: number }>();

mkdirSync(storageRoot, { recursive: true });
const db = createAppDatabase(databasePath);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function createSession(login: string) {
  const token = crypto.randomUUID();
  sessions.set(token, { login, createdAt: Date.now() });
  return token;
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies.session;
  if (!token || !sessions.has(token)) {
    res.status(401).json({ error: 'Требуется вход в систему' });
    return;
  }
  next();
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

function parseId(value: unknown) {
  const scalar = Array.isArray(value) ? value[0] : value;
  const id = Number(scalar);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Некорректный идентификатор');
  return id;
}

function toPublicRow(row: ReturnType<typeof db.listRows>[number]) {
  return {
    ...row,
    signatureUrl: row.signaturePath ? `/api/files/${row.signaturePath}` : null
  };
}

function localNetworkUrls() {
  const urls = [`http://localhost:${port}`];
  const interfaces = networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        urls.push(`http://${address.address}:${port}`);
      }
    }
  }
  return urls;
}

async function main() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));

  app.post('/api/login', (req, res) => {
    const { login, password } = req.body as { login?: string; password?: string };
    if (login !== adminLogin || password !== adminPassword) {
      res.status(401).json({ error: 'Неверный логин или пароль' });
      return;
    }

    const token = createSession(login);
    res.cookie('session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 12
    });
    res.json({ login });
  });

  app.post('/api/logout', (req, res) => {
    const token = req.cookies.session;
    if (token) sessions.delete(token);
    res.clearCookie('session');
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    const token = req.cookies.session;
    const session = token ? sessions.get(token) : null;
    if (!session) {
      res.json({ login: null });
      return;
    }
    res.json({ login: session.login });
  });

  app.use('/api/files', requireAuth, express.static(storageRoot));

  app.get('/api/payouts', requireAuth, (req, res) => {
    res.json({ payouts: db.listPayouts() });
  });

  app.post('/api/payouts', requireAuth, (req, res) => {
    const { title, basis } = req.body as { title?: string; basis?: string };
    const payout = db.createPayout({ title: title ?? '', basis: basis ?? '' });
    res.status(201).json({ payout });
  });

  app.delete('/api/payouts/:id', requireAuth, (req, res) => {
    const payoutId = parseId(req.params.id);
    db.deletePayout(payoutId);
    rmSync(path.join(storageRoot, 'signatures', String(payoutId)), { recursive: true, force: true });
    res.json({ ok: true });
  });

  app.get('/api/payouts/:id', requireAuth, (req, res) => {
    const payoutId = parseId(req.params.id);
    const payout = db.getPayout(payoutId);
    if (!payout) {
      res.status(404).json({ error: 'Выплата не найдена' });
      return;
    }
    const rows = db.listRows(payoutId).map(toPublicRow);
    res.json({ payout, rows, summary: summarizeRows(rows) });
  });

  app.post('/api/payouts/:id/import', requireAuth, upload.single('file'), (req, res) => {
    const payoutId = parseId(req.params.id);
    if (!req.file) throw new Error('Загрузите Excel или CSV-файл');

    const rows = parseImportWorkbook(req.file.buffer, req.file.originalname);
    const savedRows = db.replacePayoutRows(payoutId, rows).map(toPublicRow);
    res.json({ rows: savedRows, summary: summarizeRows(savedRows) });
  });

  app.get('/api/payouts/:id/search', requireAuth, (req, res) => {
    const payoutId = parseId(req.params.id);
    const query = String(req.query.q ?? '');
    const rows = db.searchRows(payoutId, query).slice(0, 12).map((row) => ({
      id: row.id,
      fullName: row.fullName,
      paidAt: row.paidAt,
      signatureUrl: row.signaturePath ? `/api/files/${row.signaturePath}` : null
    }));
    res.json({ rows });
  });

  app.post('/api/payouts/:id/rows/:rowId/sign', requireAuth, (req, res) => {
    const payoutId = parseId(req.params.id);
    const rowId = parseId(req.params.rowId);
    const { signatureDataUrl, paidAmount } = req.body as { signatureDataUrl?: string; paidAmount?: number };
    if (!signatureDataUrl) throw new Error('Подпись не передана');

    const savedSignature = saveSignatureDataUrl({ storageRoot, payoutId, rowId, dataUrl: signatureDataUrl });
    const row = db.markRowSigned({
      payoutId,
      rowId,
      paidAmount: Number(paidAmount),
      signaturePath: savedSignature.relativePath,
      signedAt: new Date().toISOString()
    });
    res.json({ row: toPublicRow(row) });
  });

  app.post('/api/payouts/:id/rows/:rowId/reset-signature', requireAuth, (req, res) => {
    const payoutId = parseId(req.params.id);
    const rowId = parseId(req.params.rowId);
    const result = db.resetRowSignature({ payoutId, rowId });
    if (result.previousSignaturePath) {
      const absolutePath = path.join(storageRoot, result.previousSignaturePath);
      if (existsSync(absolutePath)) unlinkSync(absolutePath);
    }
    res.json({ row: toPublicRow(result.row) });
  });

  app.get('/api/payouts/:id/report.xlsx', requireAuth, asyncRoute(async (req, res) => {
    const payoutId = parseId(req.params.id);
    const payout = db.getPayout(payoutId);
    if (!payout) {
      res.status(404).json({ error: 'Выплата не найдена' });
      return;
    }

    const buffer = await buildPayoutReport({ payout, rows: db.listRows(payoutId), storageRoot });
    const fileName = encodeURIComponent(`${payout.title}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
    res.send(Buffer.from(buffer));
  }));

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    res.status(400).json({ error: err.message || 'Ошибка запроса' });
  });

  if (isProduction) {
    const distDir = path.join(appRoot, 'dist');
    app.use(express.static(distDir));
    app.get(/.*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
  } else {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'custom' });
    app.use(vite.middlewares);
    app.use(/.*/, asyncRoute(async (req, res) => {
      const indexPath = path.join(appRoot, 'index.html');
      let template = readFileSync(indexPath, 'utf8');
      template = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
    }));
  }

  app.listen(port, '0.0.0.0', () => {
    process.stdout.write(`Выплаты доступны:\n${localNetworkUrls().map((url) => `- ${url}`).join('\n')}\n`);
  });
}

process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
