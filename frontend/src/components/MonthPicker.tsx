import { currentMonth, monthLabel, shiftMonth } from '../lib/format';

export function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const atCurrent = month >= currentMonth();
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-line bg-card p-1">
      <Arrow dir="left" onClick={() => onChange(shiftMonth(month, -1))} label="Previous month" />
      <span className="min-w-36 text-center text-sm font-semibold">{monthLabel(month)}</span>
      <Arrow dir="right" onClick={() => onChange(shiftMonth(month, 1))} label="Next month" disabled={atCurrent} />
    </div>
  );
}

function Arrow({ dir, onClick, label, disabled }: { dir: 'left' | 'right'; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} className="grid size-8 place-items-center rounded-full hover:bg-paper disabled:opacity-30">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
      </svg>
    </button>
  );
}
