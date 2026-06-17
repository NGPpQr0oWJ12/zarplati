export type PayoutSummary = {
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  totalCount: number;
  paidCount: number;
  partialCount: number;
  pendingCount: number;
};

export type Payout = {
  id: number;
  title: string;
  basis: string;
  status: 'active' | 'closed';
  createdAt: string;
};

export type PayoutListItem = Payout & {
  summary: PayoutSummary;
};

export type PayoutRow = {
  id: number;
  payoutId: number;
  fullName: string;
  amount: number;
  paidAmount: number | null;
  paidAt: string | null;
  signaturePath: string | null;
  signatureUrl: string | null;
  createdAt: string;
};

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Ошибка запроса' }));
    throw new Error(payload.error || 'Ошибка запроса');
  }

  return response.json() as Promise<T>;
}

export const api = {
  me() {
    return request<{ login: string | null }>('/api/me');
  },

  login(login: string, password: string) {
    return request<{ login: string }>('/api/login', { method: 'POST', body: JSON.stringify({ login, password }) });
  },

  logout() {
    return request<{ ok: boolean }>('/api/logout', { method: 'POST' });
  },

  listPayouts() {
    return request<{ payouts: PayoutListItem[] }>('/api/payouts');
  },

  createPayout(title: string, basis: string) {
    return request<{ payout: Payout }>('/api/payouts', { method: 'POST', body: JSON.stringify({ title, basis }) });
  },

  deletePayout(id: number) {
    return request<{ ok: boolean }>(`/api/payouts/${id}`, { method: 'DELETE' });
  },

  getPayout(id: number) {
    return request<{ payout: Payout; rows: PayoutRow[]; summary: PayoutSummary }>(`/api/payouts/${id}`);
  },

  importRows(id: number, file: File) {
    const form = new FormData();
    form.append('file', file);
    return request<{ rows: PayoutRow[]; summary: PayoutSummary }>(`/api/payouts/${id}/import`, { method: 'POST', body: form });
  },

  importBackup(file: File) {
    const form = new FormData();
    form.append('file', file);
    return request<{ ok: boolean; payouts: PayoutListItem[] }>('/api/backup/import', { method: 'POST', body: form });
  },

  signRow(payoutId: number, rowId: number, signatureDataUrl: string, paidAmount: number) {
    return request<{ row: PayoutRow }>(`/api/payouts/${payoutId}/rows/${rowId}/sign`, {
      method: 'POST',
      body: JSON.stringify({ signatureDataUrl, paidAmount })
    });
  },

  resetSignature(payoutId: number, rowId: number) {
    return request<{ row: PayoutRow }>(`/api/payouts/${payoutId}/rows/${rowId}/reset-signature`, { method: 'POST' });
  }
};
