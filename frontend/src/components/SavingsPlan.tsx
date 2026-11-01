import { useState } from 'react';
import { api, type Plan } from '../lib/api';
import { categoryColor } from '../lib/categories';
import { incomeLabel, inr } from '../lib/format';
import { IncomeFields, type IncomeValue } from './IncomeFields';

const toRupees = (p: number | null) => (p ? String(Math.round(p / 100)) : '');

/** Income, savings goal, and budgets suggested to reach the goal. */
export function SavingsPlan({ plan, spentThisMonth, onChanged }: { plan: Plan; spentThisMonth: number; onChanged: () => void }) {
  const [editing, setEditing] = useState(!plan.monthlyIncomePaise);
  const [form, setForm] = useState<IncomeValue>({
    incomeType: plan.incomeType ?? 'salary',
    monthlyIncome: toRupees(plan.monthlyIncomePaise),
    savingsGoal: toRupees(plan.savingsGoalPaise),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      onChanged();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const save = async () => {
    const ok = await run(() => api('/api/plan', { method: 'PUT', json: { ...form, savingsGoal: form.savingsGoal || null } }));
    if (ok) setEditing(false);
  };
  const apply = () => run(() => api('/api/plan/apply', { method: 'POST' }));

  if (editing || !plan.monthlyIncomePaise || !plan.incomeType) {
    return (
      <section className="card space-y-4 p-5">
        <div>
          <h2 className="font-display text-xl">Savings plan</h2>
          <p className="mt-1 text-sm text-muted">Tell us what comes in each month and what you'd like to keep. We'll suggest budgets to get there.</p>
        </div>
        <IncomeFields value={form} onChange={setForm} />
        {error && <p className="text-sm text-clay">{error}</p>}
        <div className="flex gap-2">
          <button onClick={save} disabled={busy || !form.monthlyIncome} className="btn btn-primary">
            {busy ? 'Saving…' : 'Save'}
          </button>
          {plan.monthlyIncomePaise && (
            <button onClick={() => setEditing(false)} className="btn btn-ghost">
              Cancel
            </button>
          )}
        </div>
      </section>
    );
  }

  const income = plan.monthlyIncomePaise;
  const goal = plan.savingsGoalPaise ?? 0;
  const leftToSpend = income - goal - spentThisMonth;
  const s = plan.suggestion;

  return (
    <section className="card space-y-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-xl">Savings plan</h2>
        <button onClick={() => setEditing(true)} className="text-sm font-semibold text-leaf hover:underline">
          Edit
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={incomeLabel(plan.incomeType)} value={inr(income)} />
        <Stat label="Savings goal" value={goal ? inr(goal) : 'Not set'} />
        <Stat
          label="Left to spend this month"
          value={inr(Math.abs(leftToSpend))}
          note={leftToSpend >= 0 ? 'and still hit your goal' : 'over: you’ll save less than your goal'}
          bad={leftToSpend < 0}
        />
      </div>

      {s && s.items.length === 0 && <p className="text-sm text-muted">No spending recorded yet. Once payments come in, we'll suggest budgets here.</p>}

      {s && s.items.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Suggested monthly budgets, based on{' '}
            {plan.basis === 'history' ? `your average over the last ${plan.months === 1 ? 'month' : `${plan.months} months`}` : 'this month so far'}.
            Fixed costs like rent and bills stay as they are; everything else is trimmed evenly to fit your goal.
          </p>

          {!s.feasible ? (
            <p className="rounded-xl bg-clay-soft p-3 text-sm text-clay">
              Your fixed costs are about {inr(s.fixedPaise)} a month, so the most you can save is {inr(s.maxSavingsPaise)}. Lower your goal to
              that or less to get a plan.
            </p>
          ) : (
            <>
              <div className="divide-y divide-line rounded-xl border border-line">
                {s.items.map((i) => (
                  <div key={i.category} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: categoryColor(i.category) }} />
                    <span className="flex-1 font-semibold">
                      {i.category}
                      {i.fixed && <FixedTag />}
                    </span>
                    <span className="money text-muted">usually {inr(i.usualPaise)}</span>
                    <span className="money w-24 text-right font-semibold">{inr(i.budgetPaise)}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">
                  Stick to these and you'll save <span className="money font-semibold text-leaf">{inr(s.projectedSavingsPaise)}</span> a month.
                </p>
                <button onClick={apply} disabled={busy} className="btn btn-primary text-sm">
                  {busy ? 'Applying…' : 'Use these budgets'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {error && <p className="text-sm text-clay">{error}</p>}
    </section>
  );
}

export function FixedTag() {
  return <span className="ml-2 rounded-full bg-paper px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Fixed</span>;
}

function Stat({ label, value, note, bad }: { label: string; value: string; note?: string; bad?: boolean }) {
  return (
    <div className="rounded-xl bg-paper p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`money mt-0.5 text-lg font-semibold ${bad ? 'text-clay' : ''}`}>{value}</p>
      {note && <p className={`text-xs ${bad ? 'text-clay' : 'text-muted'}`}>{note}</p>}
    </div>
  );
}
