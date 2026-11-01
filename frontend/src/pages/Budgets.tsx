import { useState } from 'react';
import { FixedTag, SavingsPlan } from '../components/SavingsPlan';
import { api, type Plan, type Summary } from '../lib/api';
import { CATEGORIES, FIXED_CATEGORIES, categoryColor } from '../lib/categories';
import { currentMonth, inr } from '../lib/format';
import { useAsync } from '../lib/hooks';

const SPEND_CATEGORIES = CATEGORIES.filter((c) => !['Income', 'Refunds', 'Transfers'].includes(c));

export function Budgets() {
  const summary = useAsync(() => api<Summary>(`/api/summary?month=${currentMonth()}`), []);
  const plan = useAsync(() => api<Plan>('/api/plan'), []);
  const s = summary.data;
  const spentBy = new Map(s?.byCategory.map((c) => [c.category, c.spentPaise]));
  const limitBy = new Map(s?.budgets.map((b) => [b.category, b.limitPaise]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl">Budgets</h1>
        <p className="mt-1 text-muted">Set a monthly limit for any category. Leave it empty for no limit.</p>
      </div>
      {(summary.error || plan.error) && <p className="card p-4 text-clay">{summary.error ?? plan.error}</p>}
      {s && plan.data && (
        <SavingsPlan
          plan={plan.data}
          spentThisMonth={s.spentPaise}
          onChanged={() => {
            plan.reload();
            summary.reload();
          }}
        />
      )}
      {s && (
        <div className="card divide-y divide-line">
          {SPEND_CATEGORIES.map((c) => (
            <BudgetRow key={`${c}:${limitBy.get(c) ?? ''}`} category={c} spent={spentBy.get(c) ?? 0} limit={limitBy.get(c) ?? null} onSaved={summary.reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function BudgetRow({ category, spent, limit, onSaved }: { category: string; spent: number; limit: number | null; onSaved: () => void }) {
  const [value, setValue] = useState(limit ? String(limit / 100) : '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const dirty = value !== (limit ? String(limit / 100) : '');

  async function save() {
    setState('saving');
    try {
      await api('/api/budgets', { method: 'PUT', json: { category, limit: value || null } });
      setState('saved');
      onSaved();
      setTimeout(() => setState('idle'), 1200);
    } catch {
      setState('error');
    }
  }

  const pct = limit ? Math.min(1, spent / limit) : 0;
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: categoryColor(category) }} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {category}
          {FIXED_CATEGORIES.includes(category) && <FixedTag />}
        </p>
        <p className="money text-xs text-muted">
          {inr(spent)} spent this month
          {limit ? ` · ${Math.round((spent / limit) * 100)}% of limit` : ''}
        </p>
        {limit && (
          <div className="mt-1.5 h-1.5 max-w-48 overflow-hidden rounded-full bg-paper">
            <div className={`h-full ${spent > limit ? 'bg-clay' : 'bg-leaf'}`} style={{ width: `${pct * 100}%` }} />
          </div>
        )}
      </div>
      <div className="relative w-28">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">₹</span>
        <input
          className="input money py-2 pl-7 text-right"
          inputMode="numeric"
          placeholder="No limit"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && dirty && save()}
        />
      </div>
      <button onClick={save} disabled={!dirty || state === 'saving'} className="btn btn-primary w-20 px-0 text-sm">
        {state === 'saving' ? '…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Retry' : 'Save'}
      </button>
    </div>
  );
}
