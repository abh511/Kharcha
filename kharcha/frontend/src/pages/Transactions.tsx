import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EditTransaction } from '../components/TxnForms';
import { TxnRow } from '../components/TxnRow';
import { api, downloadCsv, type Txn } from '../lib/api';
import { CATEGORIES } from '../lib/categories';
import { dayLabel, inr, monthLabel } from '../lib/format';
import { useOnDataChanged } from '../lib/hooks';

export function Transactions() {
  const [params, setParams] = useSearchParams();
  const category = params.get('category') ?? '';
  const month = params.get('month') ?? '';
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Txn[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Txn | null>(null);

  // Debounce search typing.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(
    async (after: string | null) => {
      setLoading(true);
      const sp = new URLSearchParams({ limit: '40' });
      if (category) sp.set('category', category);
      if (month) sp.set('month', month);
      if (query) sp.set('q', query);
      if (after) sp.set('cursor', after);
      try {
        const page = await api<{ items: Txn[]; nextCursor: string | null }>(`/api/transactions?${sp}`);
        setItems((prev) => (after ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setError('');
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [category, month, query],
  );

  useEffect(() => {
    load(null);
  }, [load]);
  useOnDataChanged(useCallback(() => load(null), [load]));

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  // Group by local day.
  const groups: { day: string; items: Txn[]; spent: number }[] = [];
  for (const t of items) {
    const day = new Date(t.occurredAt).toDateString();
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) groups.push((g = { day, items: [], spent: 0 }));
    g.items.push(t);
    if (t.direction === 'debit') g.spent += t.amountPaise;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl">Activity</h1>
        <button onClick={() => downloadCsv()} className="btn btn-ghost text-sm">
          Export CSV
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs flex-1" placeholder="Search name, UPI ID or note" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-auto" value={category} onChange={(e) => setFilter('category', e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        {month && (
          <button onClick={() => setFilter('month', '')} className="rounded-full bg-ink px-3 text-sm font-semibold text-paper">
            {monthLabel(month)} ✕
          </button>
        )}
      </div>

      {groups.map((g) => (
        <section key={g.day} className="card overflow-hidden">
          <div className="flex justify-between border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted">
            <span>{dayLabel(g.items[0]!.occurredAt)}</span>
            {g.spent > 0 && <span className="money">{inr(g.spent)}</span>}
          </div>
          <div className="divide-y divide-line">
            {g.items.map((t) => (
              <TxnRow key={t.id} t={t} onClick={() => setEditing(t)} />
            ))}
          </div>
        </section>
      ))}

      {error && <p className="card p-4 text-clay">{error}</p>}
      {!loading && !error && items.length === 0 && <p className="card p-8 text-center text-muted">No transactions match.</p>}
      {cursor && (
        <button onClick={() => load(cursor)} disabled={loading} className="btn btn-ghost mx-auto block">
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
      <EditTransaction txn={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
