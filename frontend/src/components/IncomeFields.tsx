import type { IncomeType } from '../lib/api';
import { incomeLabel } from '../lib/format';

export interface IncomeValue {
  incomeType: IncomeType;
  monthlyIncome: string;
  savingsGoal: string;
}

/** Salary vs allowance, the monthly amount, and an optional savings goal. Amounts are whole rupees. */
export function IncomeFields({ value, onChange }: { value: IncomeValue; onChange: (v: IncomeValue) => void }) {
  const set = (patch: Partial<IncomeValue>) => onChange({ ...value, ...patch });
  const digits = (s: string) => s.replace(/[^\d]/g, '');

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1 block text-sm text-muted">I am</span>
        <div className="grid grid-cols-2 gap-2">
          {([['salary', 'Working'], ['allowance', 'A student']] as const).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => set({ incomeType: t })}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                value.incomeType === t ? 'border-leaf bg-leaf-soft text-leaf' : 'border-line bg-white text-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm text-muted">{incomeLabel(value.incomeType)}</span>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">₹</span>
          <input
            className="input money pl-7"
            inputMode="numeric"
            required
            placeholder={value.incomeType === 'salary' ? '50000' : '8000'}
            value={value.monthlyIncome}
            onChange={(e) => set({ monthlyIncome: digits(e.target.value) })}
          />
        </div>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-muted">How much do you want to save each month?</span>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">₹</span>
          <input
            className="input money pl-7"
            inputMode="numeric"
            placeholder="Optional"
            value={value.savingsGoal}
            onChange={(e) => set({ savingsGoal: digits(e.target.value) })}
          />
        </div>
      </label>
    </div>
  );
}
