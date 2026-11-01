import type { Txn } from '../lib/api';
import { categoryColor } from '../lib/categories';
import { inr, timeLabel } from '../lib/format';

export function TxnRow({ t, onClick }: { t: Txn; onClick?: () => void }) {
  const color = categoryColor(t.category);
  const credit = t.direction === 'credit';
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-paper/70">
      <span
        className="grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold"
        style={{ background: `${color}1F`, color }}
        aria-hidden
      >
        {t.merchant.trim().charAt(0).toUpperCase() || '?'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{t.merchant}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="size-1.5 rounded-full" style={{ background: color }} />
          {t.category}
          <span>·</span>
          {timeLabel(t.occurredAt)}
          {t.source === 'manual' ? <span>· cash/manual</span> : t.bank ? <span className="hidden sm:inline">· {t.bank}</span> : null}
        </span>
      </span>
      <span className={`money shrink-0 font-semibold ${credit ? 'text-leaf' : ''}`}>
        {credit ? '+' : '−'}
        {inr(t.amountPaise)}
      </span>
    </button>
  );
}
