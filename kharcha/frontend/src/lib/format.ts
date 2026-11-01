const whole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const exact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹1,250 or ₹1,250.50 — paise only when there are any. */
export function inr(paise: number): string {
  return paise % 100 === 0 ? whole.format(paise / 100) : exact.format(paise / 100);
}

export const incomeLabel = (t: 'salary' | 'allowance') => (t === 'salary' ? 'Monthly salary' : 'Monthly allowance');

/** Compact for chart axes: ₹1.2k, ₹3.4L */
export function inrShort(paise: number): string {
  const r = paise / 100;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(r >= 1e6 ? 0 : 1)}L`;
  if (r >= 1e3) return `₹${(r / 1e3).toFixed(r >= 1e4 ? 0 : 1)}k`;
  return `₹${Math.round(r)}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

/** For <input type="datetime-local"> */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
