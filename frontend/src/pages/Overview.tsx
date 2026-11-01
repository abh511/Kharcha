import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MonthPicker } from '../components/MonthPicker';
import { EditTransaction } from '../components/TxnForms';
import { TxnRow } from '../components/TxnRow';
import { api, type Summary, type Txn } from '../lib/api';
import { categoryColor } from '../lib/categories';
import { currentMonth, inr, inrShort } from '../lib/format';
import { useAsync, useOnDataChanged } from '../lib/hooks';

export function Overview() {
  const [month, setMonth] = useState(currentMonth());
  const [editing, setEditing] = useState<Txn | null>(null);
  const summary = useAsync(() => api<Summary>(`/api/summary?month=${month}`), [month]);
  const recent = useAsync(() => api<{ items: Txn[] }>(`/api/transactions?month=${month}&limit=6`), [month]);
  useOnDataChanged(summary.reload);
  useOnDataChanged(recent.reload);

  const s = summary.data;
  const change = s && s.previousMonthSpentPaise > 0 ? (s.spentPaise - s.previousMonthSpentPaise) / s.previousMonthSpentPaise : null;
  const maxCat = Math.max(1, ...(s?.byCategory.map((c) => c.spentPaise) ?? [1]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-muted">Spent</p>
          <p className="money font-display text-5xl leading-tight sm:text-6xl">{s ? inr(s.spentPaise) : '—'}</p>
          {s && (
            <p className="mt-1 text-sm text-muted">
              {change === null ? (
                'No data for last month yet'
              ) : (
                <>
                  <span className={change > 0 ? 'font-semibold text-clay' : 'font-semibold text-leaf'}>
                    {change > 0 ? '▲' : '▼'} {Math.abs(Math.round(change * 100))}%
                  </span>{' '}
                  vs last month · received <span className="money font-semibold text-ink">{inr(s.receivedPaise)}</span>
                </>
              )}
            </p>
          )}
        </div>
        <MonthPicker month={month} onChange={setMonth} />
      </div>

      {summary.error && <p className="card p-4 text-clay">{summary.error}</p>}

      {s && s.count === 0 && <EmptyState />}

      {s && s.count > 0 && (
        <>
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-muted">Daily spending</h2>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s.daily} margin={{ top: 4, right: 0, left: -12, bottom: 0 }}>
                  <XAxis dataKey="date" tickFormatter={(d: string) => String(Number(d.slice(8)))} tick={{ fontSize: 11, fill: '#6f6a5e' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={inrShort} tick={{ fontSize: 11, fill: '#6f6a5e' }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip
                    cursor={{ fill: '#efe8d8' }}
                    contentStyle={{ borderRadius: 12, border: '1px solid #e4ddcd', background: '#fffdf8' }}
                    labelFormatter={(d) => new Date(String(d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    formatter={(v) => [inr(Number(v)), 'Spent']}
                  />
                  <Bar dataKey="spentPaise" fill="#1f4d3a" radius={[4, 4, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid gap-5 md:grid-cols-2">
            <section className="card p-5">
              <h2 className="mb-4 text-sm font-semibold text-muted">Where it went</h2>
              <ul className="space-y-3">
                {s.byCategory.map((c) => (
                  <li key={c.category}>
                    <Link to={`/transactions?category=${encodeURIComponent(c.category)}&month=${month}`} className="block">
                      <div className="mb-1 flex items-baseline justify-between text-sm">
                        <span className="font-semibold">{c.category}</span>
                        <span className="money">
                          {inr(c.spentPaise)} <span className="text-muted">· {Math.round((c.spentPaise / s.spentPaise) * 100)}%</span>
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-paper">
                        <div className="h-full rounded-full" style={{ width: `${(c.spentPaise / maxCat) * 100}%`, background: categoryColor(c.category) }} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <div className="space-y-5">
              {s.budgets.length > 0 && (
                <section className="card p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-muted">Budgets</h2>
                    <Link to="/budgets" className="text-sm font-semibold text-leaf">Edit</Link>
                  </div>
                  <ul className="space-y-3">
                    {s.budgets.map((b) => {
                      const pct = b.spentPaise / b.limitPaise;
                      return (
                        <li key={b.category}>
                          <div className="mb-1 flex justify-between text-sm">
                            <span className="font-semibold">{b.category}</span>
                            <span className={`money ${pct > 1 ? 'font-semibold text-clay' : 'text-muted'}`}>
                              {inr(b.spentPaise)} / {inr(b.limitPaise)}
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-paper">
                            <div
                              className={`h-full rounded-full ${pct > 1 ? 'bg-clay' : pct > 0.8 ? 'bg-[#D19A2A]' : 'bg-leaf'}`}
                              style={{ width: `${Math.min(100, pct * 100)}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              <section className="card p-5">
                <h2 className="mb-3 text-sm font-semibold text-muted">Top places</h2>
                <ol className="space-y-2">
                  {s.topMerchants.map((m, i) => (
                    <li key={m.merchant} className="flex items-center gap-3 text-sm">
                      <span className="w-4 text-muted">{i + 1}</span>
                      <span className="flex-1 truncate font-semibold">{m.merchant}</span>
                      <span className="text-muted">{m.count}×</span>
                      <span className="money w-24 text-right">{inr(m.spentPaise)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </div>

          <section className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 pb-1 pt-4">
              <h2 className="text-sm font-semibold text-muted">Latest</h2>
              <Link to={`/transactions?month=${month}`} className="text-sm font-semibold text-leaf">See all</Link>
            </div>
            <div className="divide-y divide-line">
              {recent.data?.items.map((t) => <TxnRow key={t.id} t={t} onClick={() => setEditing(t)} />)}
            </div>
          </section>
        </>
      )}
      <EditTransaction txn={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card p-8 text-center">
      <p className="font-display text-2xl">Nothing here yet</p>
      <p className="mx-auto mt-2 max-w-sm text-muted">
        Connect your phone so every bank SMS lands here automatically, or add a cash expense with the + button.
      </p>
      <Link to="/setup" className="btn btn-primary mt-5 inline-block">
        Connect bank SMS
      </Link>
    </div>
  );
}
