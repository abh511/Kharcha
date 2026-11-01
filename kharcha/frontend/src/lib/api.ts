export type Direction = 'debit' | 'credit';

export interface Txn {
  id: number;
  amountPaise: number;
  direction: Direction;
  merchant: string;
  vpa: string | null;
  category: string;
  bank: string | null;
  accountLast4: string | null;
  upiRef: string | null;
  source: 'sms' | 'email' | 'csv' | 'manual' | 'statement';
  note: string;
  occurredAt: string;
}

export interface Summary {
  month: string;
  spentPaise: number;
  receivedPaise: number;
  count: number;
  previousMonthSpentPaise: number;
  byCategory: { category: string; spentPaise: number; count: number }[];
  daily: { date: string; spentPaise: number }[];
  topMerchants: { merchant: string; spentPaise: number; count: number }[];
  budgets: { category: string; limitPaise: number; spentPaise: number }[];
}

export interface RawMessage {
  id: number;
  sender: string;
  body: string;
  status: 'queued' | 'parsed' | 'ignored' | 'duplicate' | 'failed';
  note: string | null;
  receivedAt: string;
}

export type IncomeType = 'salary' | 'allowance';

export interface Plan {
  incomeType: IncomeType | null;
  monthlyIncomePaise: number | null;
  savingsGoalPaise: number | null;
  /** 'history' = average of the last `months` complete months; 'this-month' = new user, this month so far. */
  basis: 'history' | 'this-month' | null;
  months: number;
  suggestion: {
    items: { category: string; fixed: boolean; usualPaise: number; budgetPaise: number }[];
    fixedPaise: number;
    availablePaise: number;
    projectedSavingsPaise: number;
    maxSavingsPaise: number;
    feasible: boolean;
  } | null;
}

const TOKEN_KEY = 'kharcha.jwt';

export const session = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* private mode: stay logged in for this tab only */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = session.get();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  const res = await fetch(path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  if (res.status === 401 && token) {
    session.clear();
    window.location.assign('/login');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function downloadCsv() {
  const res = await fetch('/api/export.csv', { headers: { authorization: `Bearer ${session.get()}` } });
  if (!res.ok) throw new ApiError(res.status, 'Export failed');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: 'kharcha-transactions.csv' });
  a.click();
  // Revoking synchronously can cancel the download in some browsers (Firefox).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
