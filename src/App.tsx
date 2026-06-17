import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent } from 'react';
import { api, type Payout, type PayoutListItem, type PayoutRow, type PayoutSummary } from './api';
import { filterRowsByStatus, getActualPaidAmount, getRemainingAmount, getRowStatus, type PayoutRowStatusFilter } from './payoutRows';

type ActivePayout = {
  payout: Payout;
  rows: PayoutRow[];
  summary: PayoutSummary;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return 'Не подписано';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase().replaceAll('ё', 'е');
}

function rowStatus(row: PayoutRow) {
  const status = getRowStatus(row);
  if (status === 'pending') return { label: 'Не получил', className: 'status pending' };
  if (status === 'partial') return { label: 'Получил частично', className: 'status partial' };
  return { label: 'Получил', className: 'status paid' };
}

function parseMoneyInput(value: string) {
  const amount = Number(value.replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [login, setLogin] = useState('ikusova');
  const [password, setPassword] = useState('123!@#QWEqwe!!!');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.login(login, password);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <p className="kicker">Локальная ведомость</p>
        <h1>Вход в выплаты</h1>
        <p className="muted">Используйте учетную запись бухгалтерии. По умолчанию: ikusova / 123!@#QWEqwe!!!.</p>
        <label>
          Логин
          <input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" />
        </label>
        <label>
          Пароль
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="primary-button" type="submit" disabled={loading}>{loading ? 'Входим' : 'Войти'}</button>
      </form>
    </main>
  );
}

function CreatePayoutForm({ onCreated }: { onCreated: (payout: Payout) => void }) {
  const [title, setTitle] = useState('');
  const [basis, setBasis] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api.createPayout(title, basis);
      setTitle('');
      setBasis('');
      onCreated(result.payout);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать выплату');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="create-form" onSubmit={handleSubmit}>
      <div>
        <h2>Новая выплата</h2>
        <p className="muted">Создайте ведомость, затем загрузите Excel или CSV с колонками ФИО и Сумма.</p>
      </div>
      <label>
        Название
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Аванс за апрель" />
      </label>
      <label>
        Основание
        <input value={basis} onChange={(event) => setBasis(event.target.value)} placeholder="Аванс за 26 апреля 2026 года" />
      </label>
      {error && <p className="error-text">{error}</p>}
      <button className="primary-button" type="submit" disabled={loading}>{loading ? 'Создание' : 'Создать выплату'}</button>
    </form>
  );
}

function PayoutsList({ payouts, selectedId, onSelect, onDelete }: { payouts: PayoutListItem[]; selectedId: number | null; onSelect: (id: number) => void; onDelete: (id: number) => void }) {
  return (
    <aside className="payout-list" aria-label="Список выплат">
      {payouts.length === 0 && <p className="muted empty-line">Выплат пока нет.</p>}
      {payouts.map((payout) => (
        <div
          className={payout.id === selectedId ? 'payout-item active' : 'payout-item'}
          key={payout.id}
        >
          <button className="payout-open" onClick={() => onSelect(payout.id)} type="button">
            <span>{payout.title}</span>
            <small>{payout.summary.paidCount}/{payout.summary.totalCount} подписали</small>
          </button>
          <button className="delete-payout" type="button" onClick={() => onDelete(payout.id)} aria-label={`Удалить ${payout.title}`}>Удалить</button>
        </div>
      ))}
    </aside>
  );
}

function BackupPanel({ onImported }: { onImported: (payouts: PayoutListItem[]) => void }) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  async function handleBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    if (!window.confirm('Импорт заменит все текущие выплаты и подписи данными из файла. Продолжить?')) return;

    setImporting(true);
    setError('');
    try {
      const result = await api.importBackup(file);
      onImported(result.payouts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось импортировать резервную копию');
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="backup-panel" aria-label="Резервная копия базы">
      <div>
        <h2>Перенос базы</h2>
        <p className="muted">Экспортирует выплаты вместе с PNG-подписями. Импорт заменяет текущую локальную базу.</p>
      </div>
      <div className="backup-actions">
        <a className="secondary-button" href="/api/backup/export">Экспорт базы</a>
        <label className="file-input backup-file">
          <input type="file" accept=".json,application/json" onChange={handleBackupFile} disabled={importing} />
          <span>{importing ? 'Импорт базы' : 'Импорт базы'}</span>
        </label>
      </div>
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}

function SignaturePad({ fullName, onChange }: { fullName: string; onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasStateRef = useRef<{ context: CanvasRenderingContext2D; rect: DOMRect; signatureLineY: number } | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const hasInkRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  function drawPaper(context: CanvasRenderingContext2D, width: number, height: number) {
    context.fillStyle = '#f7f4e9';
    context.fillRect(0, 0, width, height);

    context.fillStyle = 'rgba(17, 32, 48, 0.025)';
    for (let y = 24; y < height; y += 24) context.fillRect(0, y, width, 1);

    const signatureLineY = Math.max(190, height - 58);
    const lineInset = Math.max(26, width * 0.06);
    context.strokeStyle = 'rgba(22, 43, 72, 0.38)';
    context.lineWidth = 1.35;
    context.beginPath();
    context.moveTo(lineInset, signatureLineY);
    context.lineTo(width - lineInset, signatureLineY);
    context.stroke();

    context.fillStyle = 'rgba(22, 43, 72, 0.74)';
    context.font = '600 15px "Geist", "Satoshi", "Plus Jakarta Sans", system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillText(fullName, width / 2, signatureLineY + 11, width - lineInset * 2);
    return signatureLineY;
  }

  function applyPenStyle(context: CanvasRenderingContext2D) {
    context.lineWidth = 2.35;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#164c9f';
    context.fillStyle = '#164c9f';
    context.globalAlpha = 0.92;
  }

  function setupCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(rect.width * ratio);
    canvas.height = Math.floor(rect.height * ratio);
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const signatureLineY = drawPaper(context, rect.width, rect.height);
    applyPenStyle(context);
    canvasStateRef.current = { context, rect, signatureLineY };
    hasInkRef.current = false;
    setHasInk(false);
    onChange(null);
  }

  useEffect(() => {
    setupCanvas();
    window.addEventListener('resize', setupCanvas);
    return () => window.removeEventListener('resize', setupCanvas);
  }, []);

  function pointFromClient(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvasStateRef.current?.rect ?? canvas.getBoundingClientRect();
    const signatureLineY = canvasStateRef.current?.signatureLineY ?? rect.height - 58;
    return {
      x: Math.max(0, Math.min(rect.width, clientX - rect.left)),
      y: Math.max(0, Math.min(signatureLineY - 4, clientY - rect.top))
    };
  }

  function updateValue() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const value = canvas.toDataURL('image/png');
    onChange(value);
  }

  function markInk() {
    if (hasInkRef.current) return;
    hasInkRef.current = true;
    setHasInk(true);
  }

  function drawPoint(point: { x: number; y: number }) {
    const context = canvasStateRef.current?.context;
    if (!context) return;
    applyPenStyle(context);
    context.beginPath();
    context.arc(point.x, point.y, 1.18, 0, Math.PI * 2);
    context.fill();
    markInk();
  }

  function drawLine(previous: { x: number; y: number }, next: { x: number; y: number }) {
    const context = canvasStateRef.current?.context;
    if (!context) return;
    applyPenStyle(context);
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    markInk();
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    canvasStateRef.current = canvasStateRef.current
      ? { ...canvasStateRef.current, rect: canvas.getBoundingClientRect() }
      : canvasStateRef.current;
    lastPointRef.current = pointFromClient(event.clientX, event.clientY);
    if (lastPointRef.current) drawPoint(lastPointRef.current);
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const coalescedEvents = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const nativeEvents = coalescedEvents.length > 0 ? coalescedEvents : [event.nativeEvent];
    let previous = lastPointRef.current;
    if (!previous) return;

    for (const nativeEvent of nativeEvents) {
      const next = pointFromClient(nativeEvent.clientX, nativeEvent.clientY);
      if (!next) continue;
      drawLine(previous, next);
      previous = next;
    }

    lastPointRef.current = previous;
  }

  function handlePointerUp(event: PointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drawingRef.current = false;
    lastPointRef.current = null;
    updateValue();
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    hasInkRef.current = false;
    setHasInk(false);
    onChange(null);
    setupCanvas();
  }

  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(event) => event.preventDefault()}
        aria-label="Поле подписи"
      />
      <div className="signature-actions">
        <span className={hasInk ? 'status paid' : 'status pending'}>{hasInk ? 'Подпись добавлена' : 'Попросите сотрудника расписаться'}</span>
        <button className="ghost-button" type="button" onClick={clear}>Очистить</button>
      </div>
    </div>
  );
}

function SignatureModal({ row, payoutId, onClose, onSigned }: { row: PayoutRow; payoutId: number; onClose: () => void; onSigned: (row: PayoutRow) => void }) {
  const [paidAmountText, setPaidAmountText] = useState(String(row.amount));
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const parsedPaidAmount = parseMoneyInput(paidAmountText);
  const draftRemainder = parsedPaidAmount === null ? row.amount : Math.max(0, row.amount - parsedPaidAmount);

  async function sign() {
    if (!signature) {
      setError('Сначала поставьте подпись');
      return;
    }

    if (parsedPaidAmount === null || parsedPaidAmount <= 0) {
      setError('Укажите фактически выданную сумму');
      return;
    }

    if (parsedPaidAmount > row.amount) {
      setError('Фактическая сумма не может быть больше суммы к выплате');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await api.signRow(payoutId, row.id, signature, parsedPaidAmount);
      onSigned(result.row);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить подпись');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="signature-modal" role="dialog" aria-modal="true" aria-labelledby="signature-title">
        <div className="modal-head">
          <div>
            <p className="kicker">Получение выплаты</p>
            <h2 id="signature-title">{row.fullName}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        {row.paidAt && row.signatureUrl ? (
          <div className="signed-panel">
            <div className="amount-grid compact">
              <div><span>Начислено</span><strong>{formatMoney(row.amount)}</strong></div>
              <div><span>Выдано</span><strong>{formatMoney(getActualPaidAmount(row))}</strong></div>
              <div><span>Остаток</span><strong>{formatMoney(getRemainingAmount(row))}</strong></div>
            </div>
            <p className={rowStatus(row).className}>{rowStatus(row).label}: {formatDate(row.paidAt)}</p>
            <img src={row.signatureUrl} alt={`Подпись ${row.fullName}`} />
          </div>
        ) : (
          <>
            <div className="amount-grid">
              <div><span>Начислено</span><strong>{formatMoney(row.amount)}</strong></div>
              <label>
                Фактически выдать
                <input inputMode="decimal" value={paidAmountText} onChange={(event) => setPaidAmountText(event.target.value)} />
              </label>
              <div><span>Остаток после подписи</span><strong>{formatMoney(draftRemainder)}</strong></div>
            </div>
            <SignaturePad fullName={row.fullName} onChange={setSignature} />
          </>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onClose}>Отмена</button>
          {!row.paidAt && <button className="primary-button" type="button" onClick={sign} disabled={loading}>{loading ? 'Сохранение' : 'Подписать'}</button>}
        </div>
      </section>
    </div>
  );
}

function PayoutDetail({ active, onRefresh }: { active: ActivePayout; onRefresh: (id: number) => void }) {
  const [query, setQuery] = useState('');
  const [selectedRow, setSelectedRow] = useState<PayoutRow | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [rows, setRows] = useState(active.rows);
  const [summary, setSummary] = useState(active.summary);
  const [statusFilter, setStatusFilter] = useState<PayoutRowStatusFilter>('all');

  useEffect(() => {
    setRows(active.rows);
    setSummary(active.summary);
    setQuery('');
    setStatusFilter('all');
  }, [active]);

  const normalizedQuery = normalizeSearch(query);
  const filteredRows = filterRowsByStatus(rows, statusFilter);
  const searchRows = normalizedQuery
    ? filteredRows.filter((row) => normalizeSearch(row.fullName).includes(normalizedQuery)).slice(0, 12)
    : [];
  const statusCounts = {
    all: rows.length,
    paid: filterRowsByStatus(rows, 'paid').length,
    pending: filterRowsByStatus(rows, 'pending').length,
    partial: filterRowsByStatus(rows, 'partial').length
  } satisfies Record<PayoutRowStatusFilter, number>;
  const statusOptions: { value: PayoutRowStatusFilter; label: string }[] = [
    { value: 'all', label: 'Все' },
    { value: 'paid', label: 'Получил' },
    { value: 'pending', label: 'Не получил' },
    { value: 'partial', label: 'Получил частично' }
  ];

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const result = await api.importRows(active.payout.id, file);
      setRows(result.rows);
      setSummary(result.summary);
      onRefresh(active.payout.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось импортировать файл');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  function updateSignedRow(updatedRow: PayoutRow) {
    const nextRows = rows.map((row) => (row.id === updatedRow.id ? updatedRow : row));
    const paidRows = nextRows.filter((row) => row.paidAt);
    const paidAmount = paidRows.reduce((sum, row) => sum + getActualPaidAmount(row), 0);
    setRows(nextRows);
    setSummary({
      totalAmount: nextRows.reduce((sum, row) => sum + row.amount, 0),
      paidAmount,
      pendingAmount: nextRows.reduce((sum, row) => sum + row.amount, 0) - paidAmount,
      totalCount: nextRows.length,
      paidCount: paidRows.length,
      partialCount: paidRows.filter((row) => getRemainingAmount(row) > 0).length,
      pendingCount: nextRows.filter((row) => !row.paidAt).length
    });
    onRefresh(active.payout.id);
  }

  async function reset(row: PayoutRow) {
    if (!window.confirm(`Сбросить подпись для ${row.fullName}?`)) return;
    setError('');
    try {
      const result = await api.resetSignature(active.payout.id, row.id);
      updateSignedRow(result.row);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сбросить подпись');
    }
  }

  return (
    <section className="detail-panel">
      <header className="detail-header">
        <div>
          <p className="kicker">Страница выплаты</p>
          <h1>{active.payout.title}</h1>
          <p className="muted">{active.payout.basis}</p>
        </div>
        <a className="secondary-button" href={`/api/payouts/${active.payout.id}/report.xlsx`}>Скачать Excel</a>
      </header>

      <div className="summary-grid" aria-label="Сводка по статусам">
        <div><span>Сотрудников</span><strong>{summary.totalCount}</strong></div>
        <div><span>Подписали</span><strong>{summary.paidCount}</strong></div>
        <div><span>Частично</span><strong>{summary.partialCount}</strong></div>
        <div><span>Ожидают</span><strong>{summary.pendingCount}</strong></div>
      </div>

      <div className="import-row">
        <label className="file-input">
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} disabled={uploading} />
          <span>{uploading ? 'Импорт файла' : 'Загрузить Excel / CSV'}</span>
        </label>
        <p className="muted">Ожидаемые колонки: ФИО и Сумма.</p>
      </div>

      <div className="queue-toolbar">
        <div className="search-box">
          <label htmlFor="employee-search">Поиск сотрудника для выдачи</label>
          <input
            id="employee-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Начните вводить ФИО"
            autoComplete="off"
          />
          {query && (
            <div className="search-results">
              {searchRows.length === 0 && <p className="muted empty-line">Ничего не найдено в текущем фильтре.</p>}
              {searchRows.map((row) => (
                <button key={row.id} type="button" onClick={() => setSelectedRow(row)}>
                  <span>{row.fullName}</span>
                  <small className={rowStatus(row).className}>{rowStatus(row).label}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="status-filter" role="group" aria-label="Фильтр по статусу">
          {statusOptions.map((option) => (
            <button
              key={option.value}
              className={statusFilter === option.value ? 'filter-chip active' : 'filter-chip'}
              type="button"
              onClick={() => setStatusFilter(option.value)}
            >
              <span>{option.label}</span>
              <strong>{statusCounts[option.value]}</strong>
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="rows-table" role="table" aria-label="Сотрудники в выплате">
        <div className="table-head" role="row">
          <span>Сотрудник</span>
          <span>Статус</span>
          <span>Подпись</span>
          <span></span>
        </div>
        {filteredRows.map((row) => (
          <div className="table-row" role="row" key={row.id}>
            <span className="employee-name">{row.fullName}</span>
            <span className={rowStatus(row).className}>{rowStatus(row).label}{row.paidAt ? ` · ${formatDate(row.paidAt)}` : ''}</span>
            <span>{row.signatureUrl ? <img className="signature-thumb" src={row.signatureUrl} alt={`Подпись ${row.fullName}`} /> : <span className="muted">Нет</span>}</span>
            <span className="row-actions">
              <button className="ghost-button" type="button" onClick={() => setSelectedRow(row)}>{row.paidAt ? 'Открыть' : 'Выдать'}</button>
              {row.paidAt && <button className="text-button" type="button" onClick={() => reset(row)}>Сброс</button>}
            </span>
          </div>
        ))}
        {filteredRows.length === 0 && (
          <div className="table-empty">
            <strong>Нет сотрудников в этом статусе</strong>
            <span>Смените фильтр или загрузите ведомость заново.</span>
          </div>
        )}
      </div>

      {selectedRow && (
        <SignatureModal
          row={selectedRow}
          payoutId={active.payout.id}
          onClose={() => setSelectedRow(null)}
          onSigned={updateSignedRow}
        />
      )}
    </section>
  );
}

export function App() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [payouts, setPayouts] = useState<PayoutListItem[]>([]);
  const [active, setActive] = useState<ActivePayout | null>(null);
  const [error, setError] = useState('');

  async function loadPayouts(selectId?: number) {
    const result = await api.listPayouts();
    setPayouts(result.payouts);
    const nextId = selectId ?? active?.payout.id ?? result.payouts[0]?.id;
    if (nextId) await loadPayout(nextId);
  }

  async function loadPayout(id: number) {
    const result = await api.getPayout(id);
    setActive(result);
  }

  useEffect(() => {
    api.me()
      .then(async (session) => {
        if (!session.login) {
          setAuthenticated(false);
          return;
        }
        setAuthenticated(true);
        await loadPayouts();
      })
      .catch(() => setAuthenticated(false))
      .finally(() => setChecking(false));
  }, []);

  async function handleLogin() {
    setAuthenticated(true);
    await loadPayouts();
  }

  async function handleCreated(payout: Payout) {
    await loadPayouts(payout.id);
  }

  async function handleLogout() {
    await api.logout();
    setAuthenticated(false);
    setActive(null);
    setPayouts([]);
  }

  async function safeLoadPayout(id: number) {
    setError('');
    try {
      await loadPayout(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось открыть выплату');
    }
  }

  async function safeRefresh(id: number) {
    setError('');
    try {
      await loadPayouts(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось обновить данные');
    }
  }

  async function handleDeletePayout(id: number) {
    const payout = payouts.find((item) => item.id === id);
    if (!payout || !window.confirm(`Удалить выплату «${payout.title}»? Это действие удалит строки и подписи этой ведомости.`)) return;

    setError('');
    try {
      await api.deletePayout(id);
      const remaining = payouts.filter((item) => item.id !== id);
      const nextId = active?.payout.id === id ? remaining[0]?.id ?? null : active?.payout.id ?? remaining[0]?.id ?? null;
      if (nextId === null) {
        setPayouts([]);
        setActive(null);
        return;
      }
      await loadPayouts(nextId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить выплату');
    }
  }

  async function handleBackupImported(importedPayouts: PayoutListItem[]) {
    setPayouts(importedPayouts);
    const nextId = importedPayouts[0]?.id ?? null;
    if (nextId) {
      await loadPayout(nextId);
      return;
    }
    setActive(null);
  }

  if (checking) return <main className="loading-screen">Загрузка</main>;
  if (!authenticated) return <LoginScreen onLogin={handleLogin} />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="kicker">Ведомости</p>
          <strong>Выплаты сотрудникам</strong>
        </div>
        <button className="ghost-button" type="button" onClick={handleLogout}>Выйти</button>
      </header>

      <div className="workspace">
        <section className="sidebar-panel">
          <CreatePayoutForm onCreated={handleCreated} />
          <BackupPanel onImported={handleBackupImported} />
          <PayoutsList payouts={payouts} selectedId={active?.payout.id ?? null} onSelect={safeLoadPayout} onDelete={handleDeletePayout} />
        </section>
        {error && <p className="error-text">{error}</p>}
        {active ? (
          <PayoutDetail active={active} onRefresh={safeRefresh} />
        ) : (
          <section className="detail-panel empty-state">
            <h1>Создайте первую выплату</h1>
            <p className="muted">После создания ведомости загрузите Excel или CSV, затем используйте поиск для выдачи.</p>
          </section>
        )}
      </div>
    </main>
  );
}
